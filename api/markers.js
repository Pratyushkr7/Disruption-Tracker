/**
 * api/markers.js  —  Vercel Serverless Function
 * Handles GET / POST / DELETE for user-added disruption markers.
 * Backed by Supabase (free Postgres).
 *
 * Environment variables required (set in Vercel dashboard):
 *   SUPABASE_URL          — e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  — "service_role" secret key (not anon)
 *   EDITOR_KEY            — secret password editors must supply to add/delete markers
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EDITOR_KEY   = process.env.EDITOR_KEY;

function supabaseHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function checkEditorKey(req, res) {
  if (!EDITOR_KEY) {
    // If no key is configured, lock down writes entirely
    res.status(500).json({ error: 'EDITOR_KEY env var not set on server.' });
    return false;
  }
  const supplied = req.headers['x-editor-key'] || '';
  if (supplied !== EDITOR_KEY) {
    res.status(401).json({ error: 'Invalid editor key.' });
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-editor-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured.' });
  }

  try {
    // ── GET  /api/markers?validate=1  —  key check only, no DB call ─────
    // Used by the frontend to verify an editor key before opening the modal.
    if (req.method === 'GET' && req.query.validate === '1') {
      if (!checkEditorKey(req, res)) return; // returns 401 if wrong
      return res.status(204).end();           // 204 = key is valid
    }

    // ── GET  /api/markers  —  public, no auth required ────────────────────
    if (req.method === 'GET') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_markers?select=db_id,data&order=created_at.asc`,
        { headers: supabaseHeaders() }
      );
      if (!r.ok) throw new Error(`Supabase GET failed: ${r.status}`);
      const rows = await r.json();

      // Attach db_id onto the data object so the frontend can DELETE later
      const markers = rows.map(row => ({
        ...row.data,
        dbId: row.db_id,
        userAdded: true,
      }));
      return res.status(200).json(markers);
    }

    // ── POST  /api/markers  —  requires editor key ────────────────────────
    if (req.method === 'POST') {
      if (!checkEditorKey(req, res)) return;

      const marker = req.body;
      if (!marker || !marker.company) {
        return res.status(400).json({ error: 'Missing marker data.' });
      }

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_markers`,
        {
          method: 'POST',
          headers: supabaseHeaders(),
          body: JSON.stringify({ data: marker }),
        }
      );
      if (!r.ok) throw new Error(`Supabase POST failed: ${r.status}`);
      const rows = await r.json();
      const saved = rows[0];

      return res.status(201).json({
        ...saved.data,
        dbId: saved.db_id,
        userAdded: true,
      });
    }

    // ── DELETE  /api/markers?dbId=X  —  requires editor key ──────────────
    if (req.method === 'DELETE') {
      if (!checkEditorKey(req, res)) return;

      const { dbId } = req.query;
      if (!dbId) return res.status(400).json({ error: 'Missing dbId.' });

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_markers?db_id=eq.${dbId}`,
        { method: 'DELETE', headers: supabaseHeaders() }
      );
      if (!r.ok) throw new Error(`Supabase DELETE failed: ${r.status}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed.' });

  } catch (err) {
    console.error('[markers API]', err);
    return res.status(500).json({ error: err.message });
  }
};
