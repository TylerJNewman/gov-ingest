import { config } from "dotenv";
import { OpenAI } from "openai";
import { supabase } from "./lib/supabase";

config();

const openai = new OpenAI();

interface Entity {
	id: number;
	name: string;
	similarity: number;
	loan_count: number;
	total_volume: number;
	score: number;
	last_updated: Date;
}

async function searchEntitiesWithRetry(
	embedding: number[],
	retries = 0,
): Promise<Entity[]> {
	const MAX_RETRIES = 3;
	const INITIAL_DELAY = 1000;

	try {
		const { data, error } = await supabase.rpc("match_entities", {
			query_embedding: embedding,
			match_threshold: 0.7,
			match_count: 5
		});

		if (error) {
			console.error("Error details:", error);
			if (error.code === "57014" && retries < MAX_RETRIES) {
				console.log(
					`⚠️ Search timeout, retrying in ${
						INITIAL_DELAY * (retries + 1)
					}ms... (${retries + 1}/${MAX_RETRIES})`,
				);
				await new Promise((resolve) =>
					setTimeout(resolve, INITIAL_DELAY * (retries + 1)),
				);
				return searchEntitiesWithRetry(embedding, retries + 1);
			}
			throw error;
		}

		return data || [];
	} catch (error) {
		console.error("Search failed:", error);
		throw error;
	}
}

async function searchEntities(query: string): Promise<void> {
	try {
		const embedding = await openai.embeddings.create({
			model: "text-embedding-ada-002",
			input: query,
		});

		const results = await searchEntitiesWithRetry(embedding.data[0].embedding);

		console.log(`\n🔍 Searching for: ${query}`);
		console.log("\nSearch Results:");
		results.forEach((entity, index) => {
			console.log(`\n${index + 1}. ${entity.name} (ID: ${entity.id})`);
			console.log(`   Match Score: ${(entity.score * 100).toFixed(1)}%`);
			console.log(`   Similarity: ${(entity.similarity * 100).toFixed(1)}%`);
			console.log(`   Volume: $${entity.total_volume.toLocaleString()}`);
			console.log(`   Loans: ${entity.loan_count.toLocaleString()}`);
			console.log(`   Last Updated: ${new Date(entity.last_updated).toLocaleDateString()}`);
		});
		console.log(`\nTotal results found: ${results.length}`);
	} catch (error) {
		console.error("Search failed:", error);
	}
}

// Example usage
const testQueries = [
	"Opendoor",
	"Offerpad",
	"Zillow",
	'Thomas James Capital',
	"TJC"
];

async function test() {
	for (const query of testQueries) {
		await searchEntities(query);
	}
}

test().catch(console.error);

export { searchEntities };
