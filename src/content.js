const { pool, logEvent } = require("./database");
const config = require("./config");

const CATEGORIES = {
  films: { label: "🎬 Filimada", channel: config.channels.films },
  series: { label: "📺 Taxanayaasha", channel: config.channels.series },
  books: { label: "📚 Buugaagta Aqoonta", channel: config.channels.books },
  curriculum: { label: "🎓 Manhajka Dowladda", channel: config.channels.curriculum }
};
const CATEGORY_BY_CHANNEL = Object.fromEntries(Object.entries(CATEGORIES).map(([k,v]) => [String(v.channel), k]));
const normalize = s => String(s || "").toLocaleLowerCase("en").normalize("NFKC")
  .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function getMedia(msg) {
  if (msg.document) return { fileId: msg.document.file_id, uniqueId: msg.document.file_unique_id, type: "document" };
  if (msg.video) return { fileId: msg.video.file_id, uniqueId: msg.video.file_unique_id, type: "video" };
  if (msg.animation) return { fileId: msg.animation.file_id, uniqueId: msg.animation.file_unique_id, type: "animation" };
  if (msg.audio) return { fileId: msg.audio.file_id, uniqueId: msg.audio.file_unique_id, type: "audio" };
  if (msg.voice) return { fileId: msg.voice.file_id, uniqueId: msg.voice.file_unique_id, type: "voice" };
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { fileId: p.file_id, uniqueId: p.file_unique_id, type: "photo" };
  }
  if (msg.video_note) return { fileId: msg.video_note.file_id, uniqueId: msg.video_note.file_unique_id, type: "video_note" };
  return { fileId: null, uniqueId: null, type: "text" };
}
function extractTitle(msg) {
  const raw = (msg.caption || msg.text || "").trim();
  const first = raw.split(/\r?\n/).find(x => x.trim()) || "";
  return first.replace(/^(title|magac)\s*:\s*/i, "").trim().slice(0, 250);
}
function inferCurriculum(text) {
  const t = String(text || "");
  const gradeMatch = t.match(/(?:fasal(?:ka)?\s*)?(\d{1,2}(?:aad|aad)?)/i);
  const subjectMatch = t.match(/(?:maado(?:da)?\s*:\s*)?[,|–-]\s*([^,|–-]+)/i);
  return { grade: gradeMatch ? gradeMatch[1].toLowerCase() : "", subject: subjectMatch ? subjectMatch[1].trim() : "" };
}
async function upsertContent(data) {
  const title = String(data.title || "").trim();
  if (!title) throw new Error("Title is required");
  const norm = normalize(title);
  const values = [
    data.category, title, norm, data.description || "", data.year || "", data.grade || "",
    data.subject || "", String(data.channelId), data.channelMessageId || null,
    data.fileId || null, data.fileUniqueId || null, data.mediaType || "unknown",
    data.source || "admin", data.createdBy ? String(data.createdBy) : null
  ];
  const q = await pool.query(`
    INSERT INTO content(category,title,normalized_title,description,year,grade,subject,channel_id,channel_message_id,file_id,file_unique_id,media_type,source,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT(channel_id,channel_message_id) DO UPDATE SET
      category=EXCLUDED.category,title=EXCLUDED.title,normalized_title=EXCLUDED.normalized_title,
      description=EXCLUDED.description,year=EXCLUDED.year,grade=EXCLUDED.grade,subject=EXCLUDED.subject,
      file_id=COALESCE(EXCLUDED.file_id,content.file_id),file_unique_id=COALESCE(EXCLUDED.file_unique_id,content.file_unique_id),
      media_type=EXCLUDED.media_type,source=EXCLUDED.source,active=TRUE,updated_at=NOW()
    RETURNING *
  `, values);
  await logEvent("content_saved", true, { category: data.category, title });
  return q.rows[0];
}
async function indexChannelPost(ctx, category) {
  const msg = ctx.channelPost;
  if (!msg) return;
  const media = getMedia(msg);
  const title = extractTitle(msg) || `${CATEGORIES[category].label} #${msg.message_id}`;
  let grade = "", subject = "";
  if (category === "curriculum") ({ grade, subject } = inferCurriculum(`${title} ${msg.caption || ""}`));
  await upsertContent({
    category, title, description: msg.caption || "", year: "", grade, subject,
    channelId: msg.chat.id, channelMessageId: msg.message_id,
    fileId: media.fileId, fileUniqueId: media.uniqueId, mediaType: media.type,
    source: "channel", createdBy: null
  });
}
async function searchContent(query, category = null) {
  const q = normalize(query);
  if (!q) return [];
  const terms = q.split(" ").filter(Boolean);
  const like = `%${q}%`;
  const values = [like, q, terms.join(" & "), config.searchLimit];
  let categorySql = "";
  if (category) { values.push(category); categorySql = ` AND category=$${values.length}`; }
  const result = await pool.query(`
    SELECT * FROM content
    WHERE active=TRUE AND (
      normalized_title LIKE $1 OR normalized_title=$2 OR
      to_tsvector('simple', title || ' ' || COALESCE(description,'') || ' ' || COALESCE(grade,'') || ' ' || COALESCE(subject,'')) @@ to_tsquery('simple', NULLIF($3,''))
    ) ${categorySql}
    ORDER BY CASE WHEN normalized_title=$2 THEN 0 WHEN normalized_title LIKE $1 THEN 1 ELSE 2 END, updated_at DESC
    LIMIT $4
  `, values);
  return result.rows;
}
async function searchCurriculum(grade, subject) {
  const g = normalize(grade), s = normalize(subject);
  const r = await pool.query(`
    SELECT * FROM content WHERE active=TRUE AND category='curriculum'
    AND (lower(regexp_replace(COALESCE(grade,''), '[^[:alnum:]]', '', 'g')) = lower(regexp_replace($1, '[^[:alnum:]]', '', 'g'))
         OR lower(title) LIKE '%' || lower($1) || '%')
    AND (lower(subject) LIKE '%' || lower($2) || '%' OR lower(title) LIKE '%' || lower($2) || '%' OR lower(description) LIKE '%' || lower($2) || '%')
    ORDER BY updated_at DESC LIMIT $3
  `, [g, s, config.searchLimit]);
  return r.rows;
}
async function findContentById(id) {
  const r = await pool.query("SELECT * FROM content WHERE id=$1", [id]);
  return r.rows[0] || null;
}
async function deactivateContent(id) {
  const r = await pool.query("UPDATE content SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id,title", [id]);
  return r.rows[0] || null;
}
async function updateTitle(id, title) {
  const r = await pool.query("UPDATE content SET title=$2,normalized_title=$3,updated_at=NOW() WHERE id=$1 RETURNING *", [id, title, normalize(title)]);
  return r.rows[0] || null;
}
async function contentStats() {
  const r = await pool.query("SELECT category,COUNT(*)::int AS count FROM content WHERE active=TRUE GROUP BY category");
  return Object.fromEntries(r.rows.map(x => [x.category, x.count]));
}
module.exports = { CATEGORIES, CATEGORY_BY_CHANNEL, normalize, getMedia, upsertContent, indexChannelPost, searchContent, searchCurriculum, findContentById, deactivateContent, updateTitle, contentStats };
