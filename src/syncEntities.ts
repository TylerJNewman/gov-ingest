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
  records: EntityRecord[],
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
      .from("entity_name_vectors")
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

interface EntityRecord {
  id: number;
  name: string;
  embedding?: number[];
  loan_count: number;
  total_volume: number;
  last_updated: Date;
}

async function syncEntityVectors(): Promise<void> {
  const syncStartTime = Date.now();
  let totalEntities = 0;
  let successfulEntities = 0;
  let failedBatches = 0;

  const sourcePool = new Pool({
    user: getEnvVar("POSTGRES_USER"),
    password: getEnvVar("POSTGRES_PASSWORD"),
    host: getEnvVar("POSTGRES_HOST"),
    database: getEnvVar("POSTGRES_DATABASE"),
    ssl: {
      rejectUnauthorized: false // Required for some PostgreSQL providers
    },
    // Add timeout settings
    statement_timeout: 30000, // 30 seconds
    query_timeout: 30000,     // 30 seconds
    connectionTimeoutMillis: 10000 // 10 seconds
  });

  try {
    console.log('🔍 Counting active entities...');
    
    // Simplified count query
    const countResult = await sourcePool.query(`
      SELECT COUNT(DISTINCT fe.id) 
      FROM leadgen.flip_entity fe
      INNER JOIN leadgen.cube c ON c.flip_entity_id = fe.id
      WHERE fe.id != -1
      AND c.msa_id IS NULL
      AND c.purchase_year IS NULL
      AND c.lender_id IS NULL;
    `);
    
    const totalCount = parseInt(countResult.rows[0].count);
    console.log(`📊 Found ${totalCount} active entities to process`);

    for (let offset = 0; offset < totalCount; offset += CONFIG.batchSize) {
      console.log(`\n🔄 Fetching batch at offset ${offset}...`);
      
      // Simplified batch query with better indexing potential
      const batch = await sourcePool.query(`
        SELECT 
          fe.id,
          fe.name,
          c.loan_count,
          c.total_volume::numeric as total_volume
        FROM leadgen.cube c
        LEFT JOIN leadgen.flip_entity fe ON fe.id = c.flip_entity_id
        WHERE c.msa_id IS NULL
        AND c.purchase_year IS NULL
        AND c.lender_id IS NULL
        AND c.flip_entity_id IS NOT NULL
        AND fe.name != ''
        ORDER BY c.total_volume DESC
        LIMIT $1 OFFSET $2`,
        [CONFIG.batchSize, offset]
      );

      const entities = batch.rows;
      totalEntities += entities.length;

      try {
        console.log(`\n📥 Processing ${entities.length} entities (Total: ${totalEntities})`);
        
        // Create rich descriptions including all relevant entity data
        const descriptions = entities.map(entity => 
          `${entity.name}. ${entity.state} based flip entity with ${entity.loan_count.toLocaleString()} loans ` +
          `and $${entity.total_volume.toLocaleString()} in volume. ` +
          `Most active in ${entity.top_state || 'various states'}, ` +
          `particularly in ${entity.top_county || 'various counties'}. ` +
          `Primary lender relationship with ${entity.top_lender || 'various lenders'}.`
        );
        
        const embedding = await getEmbeddingsWithRetry(descriptions);

        const records = entities.map((entity, index) => ({
          id: entity.id,
          name: entity.name,
          embedding: embedding.data[index].embedding,
          loan_count: entity.loan_count,
          total_volume: entity.total_volume,
          last_updated: new Date()
        }));

        await upsertWithRetry(records);
        successfulEntities += entities.length;

        // Log progress
        const elapsedMinutes = (Date.now() - syncStartTime) / 1000 / 60;
        console.log(
          `📈 Progress: ${successfulEntities}/${totalCount} entities (${(
            successfulEntities / elapsedMinutes
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
syncEntityVectors().catch(console.error);

export { syncEntityVectors };

// Add this to the top of your file to suppress the warning
process.removeAllListeners('warning');