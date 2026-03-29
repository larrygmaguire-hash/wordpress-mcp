#!/usr/bin/env node
/**
 * WordPress MCP Server
 *
 * Provides Claude Code access to WordPress REST API for:
 * - Posts (list, get, create, update, delete)
 * - Categories and Tags
 * - Media uploads
 *
 * Configured for humanperformance.ie
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";

// Configuration from environment variables
const WORDPRESS_SITE_URL = process.env.WORDPRESS_SITE_URL || "https://humanperformance.ie";
const WORDPRESS_USERNAME = process.env.WORDPRESS_USERNAME || "";
const WORDPRESS_APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD || "";

// API endpoints
const API_BASE_URL = `${WORDPRESS_SITE_URL}/wp-json/wp/v2`;
const XMLRPC_URL = `${WORDPRESS_SITE_URL}/xmlrpc.php`;

// Default taxonomy IDs for TFOW articles
const DEFAULT_CATEGORY_ID = 292; // Artificial Intelligence
const DEFAULT_TAG_IDS = [294, 295]; // AI, Future of Work

/**
 * Generate Basic Auth header from username and app password
 */
function getAuthHeader(): string {
  // Remove any spaces from app password (WordPress app passwords have spaces for readability)
  const cleanPassword = WORDPRESS_APP_PASSWORD.replace(/\s/g, "");
  const credentials = Buffer.from(`${WORDPRESS_USERNAME}:${cleanPassword}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Make authenticated request to WordPress REST API
 */
async function wpRequest(
  endpoint: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: object | FormData,
  isFormData = false
): Promise<unknown> {
  if (!WORDPRESS_USERNAME || !WORDPRESS_APP_PASSWORD) {
    throw new Error(
      "WordPress credentials not configured. Please set WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD in environment."
    );
  }

  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
  };

  // Only set Content-Type for non-FormData requests
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const options: {
    method: string;
    headers: Record<string, string>;
    body?: string | Buffer;
  } = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT")) {
    if (isFormData) {
      // For media uploads, body is already the file buffer
      options.body = body as unknown as Buffer;
    } else {
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorText;
    } catch {
      errorMessage = errorText;
    }
    throw new Error(`WordPress API error: ${response.status} ${response.statusText} - ${errorMessage}`);
  }

  // Handle DELETE requests that might return empty response
  if (method === "DELETE") {
    const text = await response.text();
    return text ? JSON.parse(text) : { deleted: true };
  }

  return response.json();
}

// Create MCP Server
const server = new Server(
  {
    name: "wordpress-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // === POSTS ===
    {
      name: "wordpress_list_posts",
      description: "List posts from WordPress with optional filters. Returns posts with their IDs, titles, status, categories, and tags.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["publish", "draft", "pending", "private", "trash", "any"],
            description: "Filter by post status (default: publish)",
          },
          categories: {
            type: "array",
            items: { type: "number" },
            description: "Filter by category IDs",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "Filter by tag IDs",
          },
          per_page: {
            type: "number",
            description: "Number of posts per page (default: 10, max: 100)",
          },
          page: {
            type: "number",
            description: "Page number for pagination (default: 1)",
          },
          search: {
            type: "string",
            description: "Search term to filter posts by title or content",
          },
          orderby: {
            type: "string",
            enum: ["date", "title", "modified", "id"],
            description: "Field to order results by (default: date)",
          },
          order: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort order (default: desc)",
          },
        },
      },
    },
    {
      name: "wordpress_get_post",
      description: "Get a single post by ID. Returns full post details including content, categories, tags, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          post_id: {
            type: "number",
            description: "The WordPress post ID",
          },
        },
        required: ["post_id"],
      },
    },
    {
      name: "wordpress_create_post",
      description: `Create a new WordPress post. Default category: Artificial Intelligence (ID: ${DEFAULT_CATEGORY_ID}). Default tags: AI (${DEFAULT_TAG_IDS[0]}), Future of Work (${DEFAULT_TAG_IDS[1]}).`,
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Post title (required)",
          },
          content: {
            type: "string",
            description: "Post content in HTML format (required)",
          },
          status: {
            type: "string",
            enum: ["publish", "draft", "pending", "private"],
            description: "Post status (default: draft)",
          },
          categories: {
            type: "array",
            items: { type: "number" },
            description: `Category IDs (default: [${DEFAULT_CATEGORY_ID}] - Artificial Intelligence)`,
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: `Tag IDs (default: [${DEFAULT_TAG_IDS.join(", ")}] - AI, Future of Work)`,
          },
          slug: {
            type: "string",
            description: "URL slug for the post (auto-generated from title if not provided)",
          },
          excerpt: {
            type: "string",
            description: "Post excerpt/summary",
          },
          featured_media: {
            type: "number",
            description: "Featured image media ID (upload via wordpress_upload_media first)",
          },
          meta: {
            type: "object",
            description: "Custom meta fields",
          },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "wordpress_update_post",
      description: "Update an existing WordPress post. Only provided fields will be updated.",
      inputSchema: {
        type: "object",
        properties: {
          post_id: {
            type: "number",
            description: "The WordPress post ID to update (required)",
          },
          title: {
            type: "string",
            description: "New post title",
          },
          content: {
            type: "string",
            description: "New post content in HTML format",
          },
          status: {
            type: "string",
            enum: ["publish", "draft", "pending", "private"],
            description: "New post status",
          },
          categories: {
            type: "array",
            items: { type: "number" },
            description: "New category IDs (replaces existing)",
          },
          tags: {
            type: "array",
            items: { type: "number" },
            description: "New tag IDs (replaces existing)",
          },
          slug: {
            type: "string",
            description: "New URL slug",
          },
          excerpt: {
            type: "string",
            description: "New post excerpt",
          },
          featured_media: {
            type: "number",
            description: "New featured image media ID",
          },
          meta: {
            type: "object",
            description: "Custom meta fields to update",
          },
        },
        required: ["post_id"],
      },
    },
    {
      name: "wordpress_delete_post",
      description: "Delete or trash a WordPress post. By default, posts are moved to trash. Use force=true to permanently delete.",
      inputSchema: {
        type: "object",
        properties: {
          post_id: {
            type: "number",
            description: "The WordPress post ID to delete (required)",
          },
          force: {
            type: "boolean",
            description: "Permanently delete instead of moving to trash (default: false)",
          },
        },
        required: ["post_id"],
      },
    },

    // === CATEGORIES ===
    {
      name: "wordpress_list_categories",
      description: "List all categories from WordPress. Returns category IDs, names, slugs, and post counts.",
      inputSchema: {
        type: "object",
        properties: {
          per_page: {
            type: "number",
            description: "Number of categories per page (default: 100)",
          },
          page: {
            type: "number",
            description: "Page number for pagination",
          },
          search: {
            type: "string",
            description: "Search term to filter categories",
          },
          hide_empty: {
            type: "boolean",
            description: "Hide categories with no posts (default: false)",
          },
        },
      },
    },

    // === TAGS ===
    {
      name: "wordpress_list_tags",
      description: "List all tags from WordPress. Returns tag IDs, names, slugs, and post counts.",
      inputSchema: {
        type: "object",
        properties: {
          per_page: {
            type: "number",
            description: "Number of tags per page (default: 100)",
          },
          page: {
            type: "number",
            description: "Page number for pagination",
          },
          search: {
            type: "string",
            description: "Search term to filter tags",
          },
          hide_empty: {
            type: "boolean",
            description: "Hide tags with no posts (default: false)",
          },
        },
      },
    },

    // === MEDIA ===
    {
      name: "wordpress_upload_media",
      description: "Upload a media file (image) to WordPress. Returns the media ID for use as featured_media in posts.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Local file path to the image to upload (required)",
          },
          title: {
            type: "string",
            description: "Title for the media item",
          },
          alt_text: {
            type: "string",
            description: "Alternative text for accessibility",
          },
          caption: {
            type: "string",
            description: "Caption for the media item",
          },
        },
        required: ["file_path"],
      },
    },

    // === YOAST SEO ===
    {
      name: "wordpress_set_yoast_meta",
      description:
        "Set Yoast SEO meta fields on a post (canonical URL, focus keyword, meta description). Uses XMLRPC to bypass Yoast's REST API restriction.",
      inputSchema: {
        type: "object",
        properties: {
          post_id: {
            type: "number",
            description: "The WordPress post ID (required)",
          },
          canonical_url: {
            type: "string",
            description: "Canonical URL for the post (sets _yoast_wpseo_canonical)",
          },
          focus_keyword: {
            type: "string",
            description: "Yoast focus keyword (sets _yoast_wpseo_focuskw)",
          },
          meta_description: {
            type: "string",
            description: "Yoast meta description (sets _yoast_wpseo_metadesc)",
          },
        },
        required: ["post_id"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const params = args as Record<string, unknown>;

  try {
    let result: unknown;

    switch (name) {
      // === POSTS ===
      case "wordpress_list_posts": {
        const queryParams = new URLSearchParams();

        if (params.status) queryParams.append("status", params.status as string);
        if (params.categories) {
          queryParams.append("categories", (params.categories as number[]).join(","));
        }
        if (params.tags) {
          queryParams.append("tags", (params.tags as number[]).join(","));
        }
        if (params.per_page) queryParams.append("per_page", String(params.per_page));
        if (params.page) queryParams.append("page", String(params.page));
        if (params.search) queryParams.append("search", params.search as string);
        if (params.orderby) queryParams.append("orderby", params.orderby as string);
        if (params.order) queryParams.append("order", params.order as string);

        const query = queryParams.toString();
        const posts = await wpRequest(`/posts${query ? `?${query}` : ""}`);

        // Simplify response for readability
        const simplifiedPosts = (posts as Array<Record<string, unknown>>).map((post) => ({
          id: post.id,
          title: (post.title as Record<string, string>)?.rendered || post.title,
          slug: post.slug,
          status: post.status,
          date: post.date,
          modified: post.modified,
          categories: post.categories,
          tags: post.tags,
          link: post.link,
          featured_media: post.featured_media,
        }));

        result = simplifiedPosts;
        break;
      }

      case "wordpress_get_post": {
        const post = await wpRequest(`/posts/${params.post_id}`) as Record<string, unknown>;

        // Return full post with rendered content
        result = {
          id: post.id,
          title: (post.title as Record<string, string>)?.rendered || post.title,
          slug: post.slug,
          status: post.status,
          date: post.date,
          modified: post.modified,
          content: (post.content as Record<string, string>)?.rendered || post.content,
          excerpt: (post.excerpt as Record<string, string>)?.rendered || post.excerpt,
          categories: post.categories,
          tags: post.tags,
          link: post.link,
          featured_media: post.featured_media,
          meta: post.meta,
        };
        break;
      }

      case "wordpress_create_post": {
        // Convert HTML content to Gutenberg blocks
        const gutenbergContent = convertToGutenbergBlocks(params.content as string);

        const postBody: Record<string, unknown> = {
          title: params.title,
          content: gutenbergContent,
          status: params.status || "draft",
          categories: params.categories || [DEFAULT_CATEGORY_ID],
          tags: params.tags || DEFAULT_TAG_IDS,
        };

        if (params.slug) postBody.slug = params.slug;
        if (params.excerpt) postBody.excerpt = params.excerpt;
        if (params.featured_media) postBody.featured_media = params.featured_media;
        if (params.meta) postBody.meta = params.meta;

        const newPost = await wpRequest("/posts", "POST", postBody) as Record<string, unknown>;

        result = {
          id: newPost.id,
          title: (newPost.title as Record<string, string>)?.rendered || newPost.title,
          slug: newPost.slug,
          status: newPost.status,
          link: newPost.link,
          categories: newPost.categories,
          tags: newPost.tags,
          message: "Post created successfully",
        };
        break;
      }

      case "wordpress_update_post": {
        const postId = params.post_id;
        const updateBody: Record<string, unknown> = {};

        if (params.title !== undefined) updateBody.title = params.title;
        // Convert HTML content to Gutenberg blocks
        if (params.content !== undefined) {
          updateBody.content = convertToGutenbergBlocks(params.content as string);
        }
        if (params.status !== undefined) updateBody.status = params.status;
        if (params.categories !== undefined) updateBody.categories = params.categories;
        if (params.tags !== undefined) updateBody.tags = params.tags;
        if (params.slug !== undefined) updateBody.slug = params.slug;
        if (params.excerpt !== undefined) updateBody.excerpt = params.excerpt;
        if (params.featured_media !== undefined) updateBody.featured_media = params.featured_media;
        if (params.meta !== undefined) updateBody.meta = params.meta;

        const updatedPost = await wpRequest(`/posts/${postId}`, "POST", updateBody) as Record<string, unknown>;

        result = {
          id: updatedPost.id,
          title: (updatedPost.title as Record<string, string>)?.rendered || updatedPost.title,
          slug: updatedPost.slug,
          status: updatedPost.status,
          link: updatedPost.link,
          categories: updatedPost.categories,
          tags: updatedPost.tags,
          message: "Post updated successfully",
        };
        break;
      }

      case "wordpress_delete_post": {
        const force = params.force === true;
        const endpoint = `/posts/${params.post_id}${force ? "?force=true" : ""}`;

        await wpRequest(endpoint, "DELETE");

        result = {
          post_id: params.post_id,
          deleted: true,
          message: force ? "Post permanently deleted" : "Post moved to trash",
        };
        break;
      }

      // === CATEGORIES ===
      case "wordpress_list_categories": {
        const queryParams = new URLSearchParams();

        queryParams.append("per_page", String(params.per_page || 100));
        if (params.page) queryParams.append("page", String(params.page));
        if (params.search) queryParams.append("search", params.search as string);
        if (params.hide_empty !== undefined) queryParams.append("hide_empty", String(params.hide_empty));

        const categories = await wpRequest(`/categories?${queryParams.toString()}`);

        const simplifiedCategories = (categories as Array<Record<string, unknown>>).map((cat) => ({
          id: cat.id,
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          count: cat.count,
          parent: cat.parent,
        }));

        result = simplifiedCategories;
        break;
      }

      // === TAGS ===
      case "wordpress_list_tags": {
        const queryParams = new URLSearchParams();

        queryParams.append("per_page", String(params.per_page || 100));
        if (params.page) queryParams.append("page", String(params.page));
        if (params.search) queryParams.append("search", params.search as string);
        if (params.hide_empty !== undefined) queryParams.append("hide_empty", String(params.hide_empty));

        const tags = await wpRequest(`/tags?${queryParams.toString()}`);

        const simplifiedTags = (tags as Array<Record<string, unknown>>).map((tag) => ({
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          description: tag.description,
          count: tag.count,
        }));

        result = simplifiedTags;
        break;
      }

      // === MEDIA ===
      case "wordpress_upload_media": {
        const filePath = params.file_path as string;

        // Check file exists
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        // Read file
        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);
        const mimeType = getMimeType(fileName);

        // Make multipart request
        const url = `${API_BASE_URL}/media`;
        const headers: Record<string, string> = {
          Authorization: getAuthHeader(),
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
        };

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: fileBuffer,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Media upload failed: ${response.status} - ${errorText}`);
        }

        const media = await response.json() as Record<string, unknown>;

        // Update alt text if provided
        if (params.alt_text || params.title || params.caption) {
          const updateBody: Record<string, unknown> = {};
          if (params.alt_text) updateBody.alt_text = params.alt_text;
          if (params.title) updateBody.title = params.title;
          if (params.caption) updateBody.caption = params.caption;

          await wpRequest(`/media/${media.id}`, "POST", updateBody);
        }

        result = {
          id: media.id,
          title: (media.title as Record<string, string>)?.rendered || media.title,
          source_url: media.source_url,
          mime_type: media.mime_type,
          message: "Media uploaded successfully. Use this ID as featured_media when creating/updating posts.",
        };
        break;
      }

      // === YOAST SEO ===
      case "wordpress_set_yoast_meta": {
        const postId = params.post_id as number;
        const fields: Record<string, string> = {};

        if (params.canonical_url !== undefined) {
          fields["_yoast_wpseo_canonical"] = params.canonical_url as string;
        }
        if (params.focus_keyword !== undefined) {
          fields["_yoast_wpseo_focuskw"] = params.focus_keyword as string;
        }
        if (params.meta_description !== undefined) {
          fields["_yoast_wpseo_metadesc"] = params.meta_description as string;
        }

        if (Object.keys(fields).length === 0) {
          throw new Error("At least one Yoast field must be provided (canonical_url, focus_keyword, or meta_description)");
        }

        const yoastResult = await setYoastMeta(postId, fields);

        result = {
          post_id: postId,
          fields_set: yoastResult.fieldsSet,
          message: `Yoast meta updated successfully on post ${postId}`,
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Convert HTML content to Gutenberg block format.
 * Extracts top-level HTML elements and wraps each in the appropriate
 * WordPress block comment. Handles nested tags (e.g. blockquote
 * containing <p>) by tracking open/close tag depth.
 */
function convertToGutenbergBlocks(html: string): string {
  if (html.includes("<!-- wp:")) {
    return html;
  }

  // Extract top-level block elements by walking the string and
  // tracking tag depth so nested tags don't cause premature splits.
  const blocks: string[] = [];
  const blockTags = new Set([
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "blockquote", "pre", "figure",
    "table", "hr", "div",
  ]);

  let i = 0;
  const len = html.length;

  while (i < len) {
    // Skip whitespace between blocks
    if (/\s/.test(html[i])) { i++; continue; }

    // Must start with '<'
    if (html[i] !== "<") {
      // Stray text outside a tag — collect until next '<'
      const nextTag = html.indexOf("<", i);
      const text = html.slice(i, nextTag === -1 ? len : nextTag).trim();
      if (text) blocks.push(`<p>${text}</p>`);
      i = nextTag === -1 ? len : nextTag;
      continue;
    }

    // Read the tag name
    const tagMatch = html.slice(i).match(/^<([a-z][a-z0-9]*)/i);
    if (!tagMatch) { i++; continue; }

    const tagName = tagMatch[1].toLowerCase();

    // Self-closing tags
    if (tagName === "hr") {
      const end = html.indexOf(">", i);
      blocks.push(html.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    if (!blockTags.has(tagName)) {
      // Inline or unknown — collect until next block-level tag
      const nextBlock = html.slice(i + 1).search(/<(?:p|h[1-6]|ul|ol|blockquote|pre|figure|table|hr|div)[\s>]/i);
      const chunk = nextBlock === -1
        ? html.slice(i).trim()
        : html.slice(i, i + 1 + nextBlock).trim();
      if (chunk) blocks.push(chunk);
      i = nextBlock === -1 ? len : i + 1 + nextBlock;
      continue;
    }

    // Track depth to find the matching close tag
    let depth = 0;
    let j = i;
    while (j < len) {
      const openIdx = html.indexOf(`<${tagName}`, j);
      const closeIdx = html.indexOf(`</${tagName}>`, j);

      if (closeIdx === -1) {
        // No close tag found — take rest of string
        j = len;
        break;
      }

      if (openIdx !== -1 && openIdx < closeIdx && openIdx !== i) {
        // Found a nested open tag before the close tag
        depth++;
        j = openIdx + tagName.length + 1;
      } else if (depth > 0) {
        depth--;
        j = closeIdx + tagName.length + 3;
      } else {
        // This close tag matches our open tag
        j = closeIdx + tagName.length + 3; // past </tagName>
        break;
      }
    }

    blocks.push(html.slice(i, j).trim());
    i = j;
  }

  // Wrap each block in the appropriate Gutenberg comment
  let result = "";
  for (const block of blocks) {
    const tag = block.match(/^<([a-z][a-z0-9]*)/i)?.[1]?.toLowerCase() || "";

    switch (tag) {
      case "p":
        result += `<!-- wp:paragraph -->\n${block}\n<!-- /wp:paragraph -->\n\n`;
        break;
      case "h1":
        result += `<!-- wp:heading {"level":1} -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "h2":
        result += `<!-- wp:heading -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "h3":
        result += `<!-- wp:heading {"level":3} -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "h4":
        result += `<!-- wp:heading {"level":4} -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "h5":
        result += `<!-- wp:heading {"level":5} -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "h6":
        result += `<!-- wp:heading {"level":6} -->\n${block}\n<!-- /wp:heading -->\n\n`;
        break;
      case "ul":
        result += `<!-- wp:list -->\n${block}\n<!-- /wp:list -->\n\n`;
        break;
      case "ol":
        result += `<!-- wp:list {"ordered":true} -->\n${block}\n<!-- /wp:list -->\n\n`;
        break;
      case "blockquote":
        result += `<!-- wp:quote -->\n${block}\n<!-- /wp:quote -->\n\n`;
        break;
      case "pre":
        result += `<!-- wp:code -->\n${block}\n<!-- /wp:code -->\n\n`;
        break;
      case "figure":
        result += `<!-- wp:image -->\n${block}\n<!-- /wp:image -->\n\n`;
        break;
      case "table":
        result += `<!-- wp:table -->\n<figure class="wp-block-table">${block}</figure>\n<!-- /wp:table -->\n\n`;
        break;
      case "hr":
        result += `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->\n\n`;
        break;
      default:
        result += `<!-- wp:html -->\n${block}\n<!-- /wp:html -->\n\n`;
        break;
    }
  }

  return result.trim();
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Set Yoast SEO meta fields on a post via XMLRPC
 * Uses wp.editPost with custom_fields since Yoast doesn't expose
 * its meta fields through the REST API by default.
 */
async function setYoastMeta(
  postId: number,
  fields: Record<string, string>
): Promise<{ success: boolean; fieldsSet: string[] }> {
  if (!WORDPRESS_USERNAME || !WORDPRESS_APP_PASSWORD) {
    throw new Error("WordPress credentials not configured.");
  }

  const cleanPassword = WORDPRESS_APP_PASSWORD.replace(/\s/g, "");

  // Build custom_fields array for XMLRPC
  const customFieldsXml = Object.entries(fields)
    .map(
      ([key, value]) => `
          <value><struct>
            <member><name>key</name><value><string>${escapeXml(key)}</string></value></member>
            <member><name>value</name><value><string>${escapeXml(value)}</string></value></member>
          </struct></value>`
    )
    .join("");

  const xmlPayload = `<?xml version="1.0"?>
<methodCall>
  <methodName>wp.editPost</methodName>
  <params>
    <param><value><int>1</int></value></param>
    <param><value><string>${escapeXml(WORDPRESS_USERNAME)}</string></value></param>
    <param><value><string>${escapeXml(cleanPassword)}</string></value></param>
    <param><value><int>${postId}</int></value></param>
    <param><value><struct>
      <member>
        <name>custom_fields</name>
        <value><array><data>${customFieldsXml}
        </data></array></value>
      </member>
    </struct></value></param>
  </params>
</methodCall>`;

  const response = await fetch(XMLRPC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: xmlPayload,
  });

  if (!response.ok) {
    throw new Error(`XMLRPC request failed: ${response.status} ${response.statusText}`);
  }

  const responseText = await response.text();

  // Check for XMLRPC fault
  if (responseText.includes("<fault>")) {
    const faultMatch = responseText.match(/<string>([^<]*)<\/string>/);
    throw new Error(`XMLRPC fault: ${faultMatch?.[1] || "Unknown error"}`);
  }

  // Check for success (boolean true)
  if (responseText.includes("<boolean>1</boolean>")) {
    return { success: true, fieldsSet: Object.keys(fields) };
  }

  throw new Error("XMLRPC returned unexpected response");
}

/**
 * Escape special characters for XML
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("WordPress MCP server started");
