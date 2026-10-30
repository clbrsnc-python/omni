// Supabase Edge Function: scopus-search
// Deploy: supabase functions deploy scopus-search
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SCOPUS_ENCRYPTION_SECRET
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();
function toB64(bytes: Uint8Array) { let s=""; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s); }
function fromB64(value: string) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
async function cryptoKey() {
  const raw = Deno.env.get("SCOPUS_ENCRYPTION_SECRET") || "";
  if (raw.length < 32) throw new Error("SCOPUS_ENCRYPTION_SECRET must be at least 32 characters");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), enc.encode(value));
  return { ciphertext: toB64(new Uint8Array(ciphertext)), iv: toB64(iv) };
}
async function decrypt(ciphertext: string, iv: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await cryptoKey(), fromB64(ciphertext));
  return new TextDecoder().decode(plain);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.slice(7);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user || !user.email_confirmed_at) return json({ error: "Verified account required" }, 401);
    const body = await req.json();
    const action = body?.action;
    if (action === "status") {
      const { data, error } = await admin.from("user_scopus_keys").select("user_id").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      return json({ configured: !!data });
    }
    if (action === "save") {
      const apiKey = String(body?.apiKey || "").trim();
      if (apiKey.length < 8 || apiKey.length > 300) return json({ error: "Invalid API key format" }, 400);
      const encrypted = await encrypt(apiKey);
      const { error } = await admin.from("user_scopus_keys").upsert({ user_id: user.id, ...encrypted, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ saved: true });
    }
    if (action === "delete") {
      const { error } = await admin.from("user_scopus_keys").delete().eq("user_id", user.id);
      if (error) throw error;
      return json({ deleted: true });
    }
    if (action === "search") {
      const term = String(body?.term || "").trim();
      if (!term || term.length > 500) return json({ error: "Search term is required and must be under 500 characters" }, 400);
      const { data: saved, error } = await admin.from("user_scopus_keys").select("ciphertext,iv").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!saved) return json({ error: "No Scopus API key saved for this account" }, 400);
      const apiKey = await decrypt(saved.ciphertext, saved.iv);
      const offsets = [0,25,50,75];
      const responses = await Promise.all(offsets.map(async start => {
        const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(`TITLE-ABS-KEY(${term}) AND OA(ALL)`)}&count=25&start=${start}&httpAccept=application/json`;
        const response = await fetch(url, { headers: { "X-ELS-APIKey": apiKey, "Accept": "application/json" } });
        if (!response.ok) return { "search-results": { entry: [] } };
        return await response.json();
      }));
      const raw = responses.flatMap(r => r?.["search-results"]?.entry || []);
      const items = raw.map((item: any) => ({
        id: item["dc:identifier"] || crypto.randomUUID(), title: item["dc:title"] || "Scopus Open Access Work",
        authors: item["dc:creator"] || "Scopus Author", year: item["prism:coverDate"] ? String(item["prism:coverDate"]).slice(0,4) : "N/A",
        journal: item["prism:publicationName"] || "Scopus Indexed Journal", doi: item["prism:doi"] || "",
        language: item.language || "Language not specified", pdfUrl: item["prism:doi"] ? `https://doi.org/${item["prism:doi"]}` : (item.link || []).find((l: any)=>l["@ref"]==="scopus")?.["@href"] || null,
        abstract: "Indexed in Elsevier Scopus Open Access database.", keywords: item.authkeywords ? String(item.authkeywords).split(/;|,/).map((k: string)=>k.trim()).filter(Boolean) : [],
        source: "Scopus OA", type: "article", peerReviewed: true
      }));
      return json({ items });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("scopus-search error", error);
    return json({ error: "Scopus operation failed" }, 500);
  }
});
