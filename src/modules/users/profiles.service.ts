import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export async function updateProfile(userId: string, values: ProfileUpdate) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update(values)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}
