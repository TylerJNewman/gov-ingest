import { config } from "dotenv";
import { OpenAI } from "openai";

import { supabase } from "./lib/supabase";

config();

const openai = new OpenAI();

interface Bill {
	package_id: string;
	title: string;
	date_issued: string;
	congress: string;
	doc_class: string;
	similarity: number;
}

async function searchBillsWithRetry(
	embedding: number[],
	startDate: string,
	endDate: string,
	retries = 0,
): Promise<Bill[]> {
	const MAX_RETRIES = 3;
	const INITIAL_DELAY = 1000;

	try {
		const { data, error } = await supabase.rpc("match_bills_by_date", {
			query_embedding: embedding,
			match_threshold: 0.7,
			match_count: 10,
			start_date: startDate,
			end_date: endDate,
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
				return searchBillsWithRetry(embedding, startDate, endDate, retries + 1);
			}
			throw error;
		}

		console.log(`Found ${data?.length || 0} results`);
		return data || [];
	} catch (error) {
		console.error("Search failed:", error);
		throw error;
	}
}

async function search(
	query: string,
	startDate: string,
	endDate: string,
): Promise<void> {
	try {
		const embedding = await openai.embeddings.create({
			model: "text-embedding-ada-002",
			input: query,
		});

		const results = await searchBillsWithRetry(
			embedding.data[0].embedding,
			startDate,
			endDate,
		);
		console.log(results);
	} catch (error) {
		console.error("Search failed:", error);
	}
}

async function sanityCheck(): Promise<void> {
	try {
		// Check if we can connect and get any bills
		const { data: bills, error: billsError } = await supabase
			.from("bills")
			.select("*")
			.limit(1);

		console.log("Basic query test:");
		if (billsError) {
			console.error("Failed to fetch bills:", billsError);
		} else {
			console.log("Found bills:", bills?.length || 0);
			console.log("Sample bill:", bills?.[0]);
		}

		// Test if the embedding column exists and has data
		const { data: embeddingTest, error: embeddingError } = await supabase
			.from("bills")
			.select("embedding")
			.limit(1);

		console.log("\nEmbedding column test:");
		if (embeddingError) {
			console.error("Failed to fetch embedding:", embeddingError);
		} else {
			console.log("Embedding exists:", !!embeddingTest?.[0]?.embedding);
		}

		// Test if the stored procedure exists
		console.log("\nStored procedure test:");
		const { data: funcTest, error: funcError } = await supabase.rpc(
			"match_bills_by_date",
			{
				query_embedding: Array(1536).fill(0), // Dummy embedding
				match_threshold: 0.8,
				match_count: 1,
				start_date: "2023-01-01",
				end_date: "2023-12-31",
			},
		);

		if (funcError) {
			console.error("Stored procedure error:", funcError);
			console.log(
				"⚠️ match_bills_by_date might not exist or has different parameters",
			);
		} else {
			console.log("Stored procedure exists and accepts parameters");
		}
	} catch (error) {
		console.error("Sanity check failed:", error);
	}
}

const topic = "health";
const topic2 = "automobiles";

// Example usage
async function test() {
	await sanityCheck();
	console.log("\nRunning search tests:");
	await search(topic, "2023-01-01", "2023-12-31");
	// await search(topic2, "2023-01-01", "2023-12-31");
}

test().catch(console.error);
