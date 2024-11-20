import { createClient } from "@supabase/supabase-js";
import { getEnvVar } from "./utils";

const ENV = {
	SUPABASE_URL: getEnvVar("SUPABASE_URL"),
	SUPABASE_ANON_KEY: getEnvVar("SUPABASE_ANON_KEY"),
} as const;

export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
