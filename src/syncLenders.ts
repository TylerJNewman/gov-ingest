import { OpenAI } from "openai";
import { config } from "dotenv";
import { supabase } from "./lib/supabase";
import { getEnvVar } from "./lib/utils";
import { Pool } from 'pg';

config();

const CONFIG = {
  batchSize: 25,
  maxRetries: 3,
  initialRetryDelay: 1000,
  maxRetryDelay: 32000
};

const openai = new OpenAI();

// Helper functions
async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertWithRetry(
  records: LenderRecord[],
  retries = 0,
  delay = CONFIG.initialRetryDelay,
): Promise<void> {
  try {
    console.log('Attempting to insert:', {
      id: records[0].id,
      name: records[0].name,
      embeddingLength: records[0].embedding?.length,
      loan_count: records[0].loan_count,
      total_volume: records[0].total_volume
    });

    const response = await supabase
      .from("lender_name_vectors")
      .upsert(records, {
        onConflict: "id"
      });

    if (response.error || response.status === 404) {
      console.log('Supabase Error Details:', response.error);
      
      if (retries < CONFIG.maxRetries) {
        const nextDelay = Math.min(delay * 2, CONFIG.maxRetryDelay);
        console.log(`⚠️ Retrying in ${delay / 1000}s... (Attempt ${retries + 1}/${CONFIG.maxRetries})`);
        await wait(delay);
        return upsertWithRetry(records, retries + 1, nextDelay);
      }
      throw new Error(`Failed to upsert: ${response.statusText} (${response.status})`);
    }

    console.log('✅ Insert successful');
  } catch (error) {
    const e = error as Error;
    console.log('Unexpected error:', e);
    
    if (retries < CONFIG.maxRetries) {
      const nextDelay = Math.min(delay * 2, CONFIG.maxRetryDelay);
      console.log(`⚠️ Upsert failed, retrying in ${delay / 1000}s... (Attempt ${retries + 1}/${CONFIG.maxRetries})`);
      await wait(delay);
      return upsertWithRetry(records, retries + 1, nextDelay);
    }
    throw error;
  }
}

async function getEmbeddingsWithRetry(
  names: string[],
  retries = 0,
  delay = CONFIG.initialRetryDelay,
) {
  try {
    return await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: names,
    });
  } catch (error) {
    if (retries < CONFIG.maxRetries) {
      const nextDelay = Math.min(delay * 2, CONFIG.maxRetryDelay);
      console.log(`⚠️ OpenAI API error, retrying in ${delay / 1000}s... (Attempt ${retries + 1}/${CONFIG.maxRetries})`);
      await wait(delay);
      return getEmbeddingsWithRetry(names, retries + 1, nextDelay);
    }
    throw error;
  }
}

interface LenderRecord {
  id: number;
  name: string;
  embedding?: number[];
  loan_count: number;
  total_volume: number;
  last_updated: Date;
}

async function syncLenderVectors(): Promise<void> {
  const syncStartTime = Date.now();
  let totalLenders = 0;
  let successfulLenders = 0;
  let failedBatches = 0;

  const sourcePool = new Pool({
    user: getEnvVar("POSTGRES_USER"),
    password: getEnvVar("POSTGRES_PASSWORD"),
    host: getEnvVar("POSTGRES_HOST"),
    database: getEnvVar("POSTGRES_DATABASE"),
    ssl: {
      rejectUnauthorized: false // Required for some PostgreSQL providers
    },
  });

  try {
    const countResult = await sourcePool.query(`
      SELECT COUNT(DISTINCT l.id) 
      FROM leadgen.lender l
      WHERE l.id != -1
      AND EXISTS (
        SELECT 1 
        FROM leadgen.cube c 
        WHERE c.lender_id = l.id 
        AND c.msa_id IS NULL 
        AND c.purchase_year IS NULL 
        AND c.flip_entity_id IS NULL
      )`);
    
    const totalCount = parseInt(countResult.rows[0].count);
    console.log(`📊 Found ${totalCount} active lenders to process`);

    for (let offset = 0; offset < totalCount; offset += CONFIG.batchSize) {
      const batch = await sourcePool.query(`
        WITH lender_metrics AS (
          SELECT 
            lender_id,
            SUM(loan_count) as total_loans,
            SUM(total_volume::numeric) as total_volume
          FROM leadgen.cube
          WHERE 
            lender_id IS NOT NULL 
            AND lender_id != -1
            AND msa_id IS NULL 
            AND purchase_year IS NULL 
            AND flip_entity_id IS NULL
          GROUP BY lender_id
        )
        SELECT 
          l.id, 
          l.name,
          COALESCE(lm.total_loans, 0) as loan_count,
          COALESCE(lm.total_volume, 0) as total_volume
        FROM leadgen.lender l
        LEFT JOIN lender_metrics lm ON lm.lender_id = l.id
        WHERE l.id != -1
        ORDER BY lm.total_volume DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
        [CONFIG.batchSize, offset]
      );

      const lenders = batch.rows;
      totalLenders += lenders.length;

      try {
        console.log(`\n📥 Processing ${lenders.length} lenders (Total: ${totalLenders})`);
        
        // Create rich descriptions including volume data
        const descriptions = lenders.map(lender => 
          `${lender.name}. Major lender with ${lender.loan_count.toLocaleString()} loans and $${lender.total_volume.toLocaleString()} in volume.`
        );
        
        const embedding = await getEmbeddingsWithRetry(descriptions);

        const records = lenders.map((lender, index) => ({
          id: lender.id,
          name: lender.name,
          embedding: embedding.data[index].embedding,
          loan_count: lender.loan_count,
          total_volume: lender.total_volume,
          last_updated: new Date()
        }));

        await upsertWithRetry(records);
        successfulLenders += lenders.length;

        // Log progress
        const elapsedMinutes = (Date.now() - syncStartTime) / 1000 / 60;
        console.log(
          `📈 Progress: ${successfulLenders}/${totalCount} lenders (${(
            successfulLenders / elapsedMinutes
          ).toFixed(1)}/min)`
        );

      } catch (error) {
        failedBatches++;
        console.error("❌ Batch failed after all retries, continuing with next batch...");
      }
    }

  } catch (error) {
    console.error("❌ Sync failed:", error);
    throw error;
  } finally {
    await sourcePool.end();
  }
}

// Run the sync
syncLenderVectors().catch(console.error);

export { syncLenderVectors };

// Add this to the top of your file to suppress the warning
process.removeAllListeners('warning');