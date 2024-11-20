import { config } from "dotenv";
import { OpenAI } from "openai";

import { supabase } from "./lib/supabase";
import { getEnvVar } from "./lib/utils";

config();

// Add date configuration
const DATE_CONFIG = {
	startDate: "2014-01-01",
	endDate: "2024-03-19",
};

const openai = new OpenAI();

const EMBEDDING_BATCH_SIZE = 100; // Smaller batch size for Supabase

// Add this to your ENV object in lib/supabase.ts or create a new config file
const GOV_API_KEY = getEnvVar("GOV_INFO_API_KEY");

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const TIMEOUT_DELAY = 5000;

// Add these interfaces at the top of the file
interface GovBill {
	packageId: string;
	title: string;
	dateIssued: string;
	lastModified: string;
	congress: string;
	docClass: string;
}

// Add this type to make the structure clear
interface BillRecord {
	package_id: string;
	title: string;
	date_issued: string;
	last_modified: string;
	congress: string;
	doc_class: string;
	embedding: number[];
}

async function upsertWithRetry(records: BillRecord[], retries = 0) {
	try {
		const { error } = await supabase.from("bills").upsert(records, {
			onConflict: "package_id",
		});

		if (error) {
			if (error.code === "57014" && retries < MAX_RETRIES) {
				console.log(
					`⚠️ Timeout error, retrying... (${retries + 1}/${MAX_RETRIES})`,
				);
				await new Promise((resolve) => setTimeout(resolve, TIMEOUT_DELAY));
				return upsertWithRetry(records, retries + 1);
			}
			throw error;
		}
	} catch (error) {
		console.error("❌ Upsert Error:", {
			error,
			batchSize: records.length,
			retryAttempt: retries + 1,
		});
		throw error;
	}
}

async function syncBills(startOffset?: string): Promise<void> {
	const syncStartTime = Date.now();
	let totalBills = 0;
	let successfulBills = 0;
	let failedBatches = 0;

	try {
		let nextPageUrl = `https://api.govinfo.gov/published/${
			DATE_CONFIG.startDate
		}/${
			DATE_CONFIG.endDate
		}?pageSize=1000&collection=BILLS&api_key=${GOV_API_KEY}&offsetMark=${
			startOffset || "*"
		}`;

		console.log(
			`🚀 Starting sync: ${DATE_CONFIG.startDate} to ${DATE_CONFIG.endDate}`,
		);
		if (startOffset) console.log(`📌 Continuing from offset: ${startOffset}`);

		while (nextPageUrl) {
			const response = await fetch(nextPageUrl, {
				headers: { Accept: "application/json" },
			});

			if (!response.ok)
				throw new Error(`HTTP error! status: ${response.status}`);

			const data = await response.json();
			if (!data.packages) return;

			const bills = data.packages;
			totalBills += bills.length;

			const offsetMatch = data.nextPage?.match(/offsetMark=([^&]+)/);
			const currentOffset = offsetMatch
				? decodeURIComponent(offsetMatch[1])
				: "none";

			console.log(
				`\n📥 Processing ${bills.length} bills (Total: ${totalBills})`,
			);
			console.log(`📌 Current Offset: ${currentOffset}`);

			for (let i = 0; i < bills.length; i += BATCH_SIZE) {
				const batch = bills.slice(i, i + BATCH_SIZE);
				try {
					const embedding = await openai.embeddings.create({
						model: "text-embedding-ada-002",
						input: batch.map((bill: GovBill) => bill.title),
					});

					const records = batch.map((bill: GovBill, index: number) => ({
						package_id: bill.packageId,
						title: bill.title,
						date_issued: bill.dateIssued,
						last_modified: bill.lastModified,
						congress: bill.congress,
						doc_class: bill.docClass,
						embedding: embedding.data[index].embedding,
					}));

					await upsertWithRetry(records);
					successfulBills += batch.length;
				} catch (error) {
					failedBatches++;
					console.error("❌ Batch failed, continuing...");
				}
			}

			// Only log progress every 1000 bills
			if (totalBills % 1000 === 0) {
				const elapsedMinutes = (Date.now() - syncStartTime) / 1000 / 60;
				console.log(
					`📈 Progress: ${successfulBills}/${totalBills} bills (${(
						successfulBills / elapsedMinutes
					).toFixed(1)}/min)`,
				);
			}

			nextPageUrl = data.nextPage
				? `${data.nextPage}&api_key=${GOV_API_KEY}`
				: "";
		}
	} catch (error) {
		console.error("❌ Sync failed:", error);
		throw error;
	} finally {
		const totalTime = ((Date.now() - syncStartTime) / 1000 / 60).toFixed(2);
		console.log(`\n🏁 Sync Complete:
			Bills: ${successfulBills}/${totalBills}
			Failed Batches: ${failedBatches}
			Time: ${totalTime} min
			Rate: ${(successfulBills / parseFloat(totalTime)).toFixed(1)}/min`);
	}
}

// Run it with the offset where it stopped
syncBills("AoJ4qd3B948DMUJJTExTLTExNGhyNDg4N3Jz").catch(console.error);

syncBills("AoJ4qd3B948DMUJJTExTLTExNGhyNDg4N3Jz").catch(console.error);
