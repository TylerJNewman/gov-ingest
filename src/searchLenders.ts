import { config } from "dotenv";
import { OpenAI } from "openai";
import { supabase } from "./lib/supabase";

config();

const openai = new OpenAI();

interface Lender {
	id: number;
	name: string;
	similarity: number;
	loan_count: number;
	total_volume: number;
	score: number;
	last_updated: Date;
}

async function searchLendersWithRetry(
	embedding: number[],
	retries = 0,
): Promise<Lender[]> {
	const MAX_RETRIES = 3;
	const INITIAL_DELAY = 1000;

	try {
		const { data, error } = await supabase.rpc("match_lenders", {
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
				return searchLendersWithRetry(embedding, retries + 1);
			}
			throw error;
		}

		return data || [];
	} catch (error) {
		console.error("Search failed:", error);
		throw error;
	}
}

async function search(query: string): Promise<void> {
	try {
		const embedding = await openai.embeddings.create({
			model: "text-embedding-ada-002",
			input: query,
		});

		const results = await searchLendersWithRetry(embedding.data[0].embedding);

		console.log(`\n🔍 Searching for: ${query}`);
		console.log("\nSearch Results:");
		results.forEach((lender, index) => {
			console.log(`\n${index + 1}. ${lender.name} (ID: ${lender.id})`);
			console.log(`   Match Score: ${(lender.score * 100).toFixed(1)}%`);
			console.log(`   Similarity: ${(lender.similarity * 100).toFixed(1)}%`);
			console.log(`   Volume: $${lender.total_volume.toLocaleString()}`);
			console.log(`   Loans: ${lender.loan_count.toLocaleString()}`);
			console.log(`   Last Updated: ${new Date(lender.last_updated).toLocaleDateString()}`);
		});
		console.log(`\nTotal results found: ${results.length}`);
	} catch (error) {
		console.error("Search failed:", error);
	}
}

// Example usage
const testQueries = [
	"Quanta",
	"Bank of America",
	"Chase",
];

async function test() {
	for (const query of testQueries) {
		await search(query);
	}
}

test().catch(console.error);

export { search };
