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

async function searchBills(
	query: string,
	options: {
		limit?: number;
		startDate?: string;
		endDate?: string;
	} = {},
): Promise<Bill[]> {
	const { limit = 5, startDate, endDate } = options;

	// Get embedding for search query
	const embedding = await openai.embeddings.create({
		model: "text-embedding-ada-002",
		input: query,
	});

	// Search using vector similarity with date filter
	const { data, error } = await supabase.rpc("match_bills_by_date", {
		query_embedding: embedding.data[0].embedding,
		match_threshold: 0.7,
		match_count: limit,
		start_date: startDate,
		end_date: endDate,
	});

	if (error) throw error;
	return data;
}

const topic = "health";
const topic2 = "automobiles";

// Example usage
async function test() {
	const results = await searchBills("health care", {
		limit: 10,
		startDate: "2020-01-01",
		endDate: "2023-12-31",
	});
	console.log(results);
}

test().catch(console.error);
