import {
	PostgrestError,
	SupabaseClient,
	createClient,
} from "@supabase/supabase-js";
import { getEnvVar } from "./utils";

const ENV = {
	SUPABASE_URL: getEnvVar("SUPABASE_URL"),
	SUPABASE_ANON_KEY: getEnvVar("SUPABASE_ANON_KEY"),
} as const;

const RETRY_CONFIG = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 32000,
} as const;

async function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DatabaseResponse<T> {
	data: T | null;
	error: PostgrestError | null;
}

class RetryableSupabaseClient extends SupabaseClient {
	async retryableRequest<T>(
		operation: () => Promise<DatabaseResponse<T>>,
		retries = 0,
		delay: number = RETRY_CONFIG.initialDelay,
	): Promise<DatabaseResponse<T>> {
		try {
			const result = await operation();

			if (result.error) {
				// Retry on timeout errors or specific database errors
				if (
					(result.error.code === "57014" || // statement_timeout
						result.error.code === "40001" || // serialization_failure
						result.error.code === "40P01") && // deadlock_detected
					retries < RETRY_CONFIG.maxRetries
				) {
					const nextDelay = Math.min(delay * 2, RETRY_CONFIG.maxDelay);
					console.log(`⚠️ Database error: ${result.error.message}`);
					console.log(
						`Retrying in ${delay / 1000}s... (Attempt ${retries + 1}/${
							RETRY_CONFIG.maxRetries
						})`,
					);
					await wait(delay);
					return this.retryableRequest(operation, retries + 1, nextDelay);
				}
			}

			return result;
		} catch (err) {
			const error = err as Error;
			if (retries < RETRY_CONFIG.maxRetries) {
				const nextDelay = Math.min(delay * 2, RETRY_CONFIG.maxDelay);
				console.log(`⚠️ Network error: ${error.message}`);
				console.log(
					`Retrying in ${delay / 1000}s... (Attempt ${retries + 1}/${
						RETRY_CONFIG.maxRetries
					})`,
				);
				await wait(delay);
				return this.retryableRequest(operation, retries + 1, nextDelay);
			}

			throw error;
		}
	}
}

export const supabase = new RetryableSupabaseClient(
	ENV.SUPABASE_URL,
	ENV.SUPABASE_ANON_KEY,
	{
		auth: {
			persistSession: false,
		},
		db: {
			schema: "public",
		},
	},
);
