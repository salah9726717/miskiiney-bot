
const { pool, logEvent } = require("./database");
const config = require("./config");

const CATEGORIES = {
  films: { label: "🎬 Filimada", channel: config.channels.films },
  series: { label: "📺 Taxanayaasha", channel: config.channels.series },
  books: { label: "📚 Buugaagta Aqoonta", channel: config.channels.books },
  curriculum: {
    label: "🎓 Manhajka Dowladda",
    channel: config.channels.curriculum
  }
};

const CATEGORY_BY_CHANNEL = Object.fromEntries(
  Object.entries(CATEGORIES)
    .filter(([, value]) => value.channel != null)
    .map(([key, value]) => [String(value.channel), key])
);

const normalize = value =>
  String(value || "")
    .toLocaleLowerCase("en")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function getMedia(msg) {
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      uniqueId: msg.document.file_unique_id,
      type: "document"
    };
  }

  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      uniqueId: msg.video.file_unique_id,
      type: "video"
    };
  }

  if (msg.animation) {
    return {
      fileId: msg.animation.file_id,
      uniqueId: msg.animation.file_unique_id,
      type: "animation"
    };
  }

  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      uniqueId: msg.audio.file_unique_id,
      type: "audio"
    };
  }

  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      uniqueId: msg.voice.file_unique_id,
      type: "voice"
    };
  }

  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];

    return {
      fileId: photo.file_id,
      uniqueId: photo.file_unique_id,
      type: "photo"
    };
  }

  if (msg.video_note) {
    return {
      fileId: msg.video_note.file_id,
      uniqueId: msg.video_note.file_unique_id,
      type: "video_note"
    };
  }

  if (msg.sticker) {
    return {
      fileId: msg.sticker.file_id,
      uniqueId: msg.sticker.file_unique_id,
      type: "sticker"
    };
  }

  return {
    fileId: null,
    uniqueId: null,
    type: "text"
  };
}

function getMediaFileName(msg) {
  const fileName =
    msg.document?.file_name ||
    msg.video?.file_name ||
    msg.audio?.file_name ||
    "";

  return String(fileName)
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[._]+/g, " ")
    .trim()
    .slice(0, 250);
}

/*
 * Caption format supported:
 *
 * The Last Kingdom
 * A historical drama.
 * Season: 1
 * Part: 2
 *
 * Also supports:
 * Season 1 / Part 2
 * S1 E2
 */
function parseCaption(msg) {
  const raw = String(msg.caption || msg.text || "").trim();
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  let title = "";
  let seasonNumber = null;
  let partNumber = null;
  const descriptionLines = [];

  for (const line of lines) {
    const seasonMatch =
      line.match(/\bseason\s*[:#-]?\s*(\d+)\b/i) ||
      line.match(/\bs\s*(\d+)\s*(?:\/|-|\s)\s*e\s*\d+\b/i);

    const partMatch =
      line.match(/\bpart\s*[:#-]?\s*(\d+)\b/i) ||
      line.match(/\bepisode\s*[:#-]?\s*(\d+)\b/i) ||
      line.match(/\bep\s*[:#-]?\s*(\d+)\b/i) ||
      line.match(/\be\s*(\d+)\b/i);

    const compactSeasonPart = line.match(/\bs(\d+)\s*e(\d+)\b/i);

    if (compactSeasonPart) {
      seasonNumber = Number(compactSeasonPart[1]);
      partNumber = Number(compactSeasonPart[2]);
      continue;
    }

    if (seasonMatch) {
      seasonNumber = Number(seasonMatch[1]);
      continue;
    }

    if (partMatch) {
      partNumber = Number(partMatch[1]);
      continue;
    }

    if (/^(title|magac)\s*:/i.test(line)) {
      if (!title) {
        title = line.replace(/^(title|magac)\s*:\s*/i, "").trim();
      }
      continue;
    }

    if (!title) {
      title = line;
    } else {
      descriptionLines.push(line);
    }
  }

  // Also accept a single line like: The Last Kingdom | Season 1 | Part 2
  if (title) {
    const inlineSeason = title.match(/\bseason\s*[:#-]?\s*(\d+)\b/i);
    const inlinePart = title.match(/\bpart\s*[:#-]?\s*(\d+)\b/i);

    if (inlineSeason && seasonNumber === null) {
      seasonNumber = Number(inlineSeason[1]);
    }

    if (inlinePart && partNumber === null) {
      partNumber = Number(inlinePart[1]);
    }

    title = title
      .replace(/\s*\|\s*(season|part)\s*[:#-]?\s*\d+/ig, "")
      .trim();
  }

  return {
    title: title.slice(0, 250),
    description: descriptionLines.join("\n").slice(0, 1500),
    seasonNumber:
      Number.isInteger(seasonNumber) && seasonNumber > 0
        ? seasonNumber
        : null,
    partNumber:
      Number.isInteger(partNumber) && partNumber > 0
        ? partNumber
        : null
  };
}

function extractTitle(msg) {
  return parseCaption(msg).title;
}

function inferCurriculum(text) {
  const value = String(text || "");

  const gradeMatch = value.match(
    /(?:fasal(?:ka)?\s*)?(\d{1,2}\s*aad)/i
  );

  const subjectMatch = value.match(
    /(?:maado(?:da)?\s*:\s*)?[,|–-]\s*([^,|–-]+)/i
  );

  return {
    grade: gradeMatch
      ? gradeMatch[1].replace(/\s+/g, "").toLowerCase()
      : "",
    subject: subjectMatch ? subjectMatch[1].trim() : ""
  };
}

async function upsertContent(data) {
  const title = String(data.title || "").trim();

  if (!title) throw new Error("Title is required");

  if (!CATEGORIES[data.category]) {
    throw new Error(`Invalid content category: ${data.category}`);
  }

  if (!data.channelId) {
    throw new Error("Storage channel ID is required");
  }

  const normalizedTitle = normalize(title);

  const values = [
    data.category,
    title,
    normalizedTitle,
    data.description || "",
    data.year || "",
    data.grade || "",
    data.subject || "",
    String(data.channelId),
    data.channelMessageId || null,
    data.fileId || null,
    data.fileUniqueId || null,
    data.mediaType || "unknown",
    data.source || "channel",
    data.createdBy ? String(data.createdBy) : null,
    data.seasonNumber ?? null,
    data.partNumber ?? null
  ];

  const result = await pool.query(
    `
    INSERT INTO content (
      category, title, normalized_title, description, year,
      grade, subject, channel_id, channel_message_id,
      file_id, file_unique_id, media_type, source, created_by,
      season_number, part_number
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16
    )
    ON CONFLICT (channel_id, channel_message_id)
    DO UPDATE SET
      category = EXCLUDED.category,

      title = CASE
        WHEN content.source = 'admin'
          AND EXCLUDED.source = 'channel'
        THEN content.title
        ELSE EXCLUDED.title
      END,

      normalized_title = CASE
        WHEN content.source = 'admin'
          AND EXCLUDED.source = 'channel'
        THEN content.normalized_title
        ELSE EXCLUDED.normalized_title
      END,

      description = CASE
        WHEN content.source = 'admin'
          AND EXCLUDED.source = 'channel'
          AND COALESCE(content.description, '') <> ''
        THEN content.description
        ELSE EXCLUDED.description
      END,

      year = COALESCE(NULLIF(EXCLUDED.year, ''), content.year),
      grade = COALESCE(NULLIF(EXCLUDED.grade, ''), content.grade),
      subject = COALESCE(NULLIF(EXCLUDED.subject, ''), content.subject),

      file_id = COALESCE(EXCLUDED.file_id, content.file_id),
      file_unique_id = COALESCE(EXCLUDED.file_unique_id, content.file_unique_id),

      media_type = CASE
        WHEN content.media_type IS NULL OR content.media_type = 'unknown'
        THEN EXCLUDED.media_type
        ELSE content.media_type
      END,

      season_number = COALESCE(EXCLUDED.season_number, content.season_number),
      part_number = COALESCE(EXCLUDED.part_number, content.part_number),

      source = CASE
        WHEN content.source = 'admin' THEN content.source
        ELSE EXCLUDED.source
      END,

      active = TRUE,
      updated_at = NOW()
    RETURNING *
    `,
    values
  );

  await logEvent("content_saved", true, {
    category: data.category,
    title,
    seasonNumber: data.seasonNumber ?? null,
    partNumber: data.partNumber ?? null
  });

  return result.rows[0];
}

async function indexChannelPost(ctx, category) {
  const msg = ctx.channelPost || ctx.editedChannelPost;
  if (!msg) return;

  if (!CATEGORIES[category]) {
    throw new Error(`Unknown channel category: ${category}`);
  }

  const media = getMedia(msg);
  const parsed = parseCaption(msg);

  const title =
    parsed.title ||
    getMediaFileName(msg) ||
    `${CATEGORIES[category].label} #${msg.message_id}`;

  let grade = "";
  let subject = "";

  if (category === "curriculum") {
    const inferred = inferCurriculum(`${title} ${msg.caption || ""}`);
    grade = inferred.grade;
    subject = inferred.subject;
  }

  const row = await upsertContent({
    category,
    title,
    description: parsed.description,
    grade,
    subject,
    seasonNumber: category === "series" ? parsed.seasonNumber : null,
    partNumber: category === "series" ? parsed.partNumber : null,
    channelId: msg.chat.id,
    channelMessageId: msg.message_id,
    fileId: media.fileId,
    fileUniqueId: media.uniqueId,
    mediaType: media.type,
    source: "channel",
    createdBy: null
  });

  console.log(
    `Indexed ${category}: ${row.title} ` +
    `(season=${row.season_number ?? "-"}, part=${row.part_number ?? "-"})`
  );

  return row;
}

async function searchContent(query, category = null) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const like = `%${normalizedQuery}%`;
  const wordLike = `%${terms.join("%")}%`;
  const tsQuery = terms.join(" & ");

  const values = [
    like,
    normalizedQuery,
    tsQuery,
    wordLike,
    config.searchLimit
  ];

  let categorySql = "";

  if (category) {
    values.push(category);
    categorySql = `AND category = $${values.length}`;
  }

  const result = await pool.query(
    `
    SELECT *
    FROM content
    WHERE active = TRUE
      AND (
        normalized_title = $2
        OR normalized_title LIKE $1
        OR normalized_title LIKE $4
        OR to_tsvector(
          'simple',
          COALESCE(title, '') || ' ' ||
          COALESCE(description, '') || ' ' ||
          COALESCE(grade, '') || ' ' ||
          COALESCE(subject, '')
        ) @@ to_tsquery('simple', NULLIF($3, ''))
      )
      ${categorySql}
    ORDER BY
      CASE
        WHEN normalized_title = $2 THEN 0
        WHEN normalized_title LIKE $1 THEN 1
        WHEN normalized_title LIKE $4 THEN 2
        ELSE 3
      END,
      updated_at DESC
    LIMIT $5
    `,
    values
  );

  return result.rows;
}

/*
 * Return one representative row per series title, rather than one row
 * for every episode. Episodes remain in content and are selected later.
 */
async function searchSeries(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const like = `%${normalizedQuery}%`;
  const tsQuery = terms.join(" & ");

  const result = await pool.query(
    `
    SELECT DISTINCT ON (normalized_title) *
    FROM content
    WHERE active = TRUE
      AND category = 'series'
      AND (
        normalized_title = $1
        OR normalized_title LIKE $2
        OR to_tsvector(
          'simple',
          COALESCE(title, '') || ' ' || COALESCE(description, '')
        ) @@ to_tsquery('simple', NULLIF($3, ''))
      )
    ORDER BY
      normalized_title,
      CASE WHEN normalized_title = $1 THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT $4
    `,
    [normalizedQuery, like, tsQuery, config.searchLimit]
  );

  return result.rows;
}

async function getSeriesSeasons(normalizedTitle) {
  const result = await pool.query(
    `
    SELECT season_number, COUNT(*)::int AS part_count
    FROM content
    WHERE active = TRUE
      AND category = 'series'
      AND normalized_title = $1
      AND season_number IS NOT NULL
      AND part_number IS NOT NULL
    GROUP BY season_number
    ORDER BY season_number ASC
    `,
    [normalizedTitle]
  );

  return result.rows;
}

async function getSeriesParts(normalizedTitle, seasonNumber) {
  const result = await pool.query(
    `
    SELECT *
    FROM content
    WHERE active = TRUE
      AND category = 'series'
      AND normalized_title = $1
      AND season_number = $2
      AND part_number IS NOT NULL
    ORDER BY part_number ASC, id ASC
    `,
    [normalizedTitle, Number(seasonNumber)]
  );

  return result.rows;
}

async function findContentById(id) {
  const result = await pool.query(
    "SELECT * FROM content WHERE id = $1",
    [id]
  );

  return result.rows[0] || null;
}

async function searchCurriculum(grade, subject) {
  const normalizedGrade = normalize(grade);
  const normalizedSubject = normalize(subject);

  const result = await pool.query(
    `
    SELECT *
    FROM content
    WHERE active = TRUE
      AND category = 'curriculum'
      AND (
        lower(regexp_replace(COALESCE(grade, ''), '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace($1, '[^[:alnum:]]', '', 'g'))
        OR lower(title) LIKE '%' || lower($1) || '%'
      )
      AND (
        lower(COALESCE(subject, '')) LIKE '%' || lower($2) || '%'
        OR lower(COALESCE(title, '')) LIKE '%' || lower($2) || '%'
        OR lower(COALESCE(description, '')) LIKE '%' || lower($2) || '%'
      )
    ORDER BY updated_at DESC
    LIMIT $3
    `,
    [normalizedGrade, normalizedSubject, config.searchLimit]
  );

  return result.rows;
}

async function deactivateContent(id) {
  const result = await pool.query(
    `
    UPDATE content
    SET active = FALSE, updated_at = NOW()
    WHERE id = $1
    RETURNING id, title
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function updateTitle(id, title) {
  const cleanTitle = String(title || "").trim().slice(0, 250);
  if (!cleanTitle) throw new Error("Title is required");

  const result = await pool.query(
    `
    UPDATE content
    SET title = $2,
        normalized_title = $3,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, cleanTitle, normalize(cleanTitle)]
  );

  return result.rows[0] || null;
}

async function contentStats() {
  const result = await pool.query(
    `
    SELECT category, COUNT(*)::int AS count
    FROM content
    WHERE active = TRUE
    GROUP BY category
    `
  );

  return Object.fromEntries(
    result.rows.map(row => [row.category, row.count])
  );
}

module.exports = {
  CATEGORIES,
  CATEGORY_BY_CHANNEL,
  normalize,
  getMedia,
  extractTitle,
  parseCaption,
  upsertContent,
  indexChannelPost,
  searchContent,
  searchSeries,
  getSeriesSeasons,
  getSeriesParts,
  searchCurriculum,
  findContentById,
  deactivateContent,
  updateTitle,
  contentStats
};
