# WordPress MCP Server

An MCP (Model Context Protocol) server that provides Claude Code access to the WordPress REST API. Configured for humanperformance.ie but can be adapted for any WordPress site with REST API enabled.

## Features

- **Posts**: List, get, create, update, and delete posts
- **Categories**: List all categories with post counts
- **Tags**: List all tags with post counts
- **Media**: Upload images for featured images

## Prerequisites

- Node.js 18 or higher
- A WordPress site with REST API enabled (default in WordPress 4.7+)
- WordPress application password (generate from Users > Your Profile > Application Passwords)

## Installation

```bash
cd /Users/larrymaguire/Developer/wordpress-mcp
npm install
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file or set these environment variables:

```bash
WORDPRESS_SITE_URL=https://humanperformance.ie
WORDPRESS_USERNAME=humanper
WORDPRESS_APP_PASSWORD=UUSn yUgM 1KlF ypsU geMv aqVB
```

### Claude Desktop Configuration

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/Users/larrymaguire/Developer/wordpress-mcp/dist/index.js"],
      "env": {
        "WORDPRESS_SITE_URL": "https://humanperformance.ie",
        "WORDPRESS_USERNAME": "humanper",
        "WORDPRESS_APP_PASSWORD": "UUSn yUgM 1KlF ypsU geMv aqVB"
      }
    }
  }
}
```

## Available Tools

### wordpress_list_posts

List posts with optional filters.

**Parameters:**
- `status`: Filter by status (publish, draft, pending, private, trash, any)
- `categories`: Array of category IDs to filter by
- `tags`: Array of tag IDs to filter by
- `per_page`: Number of posts per page (default: 10, max: 100)
- `page`: Page number for pagination
- `search`: Search term for title/content
- `orderby`: Sort field (date, title, modified, id)
- `order`: Sort direction (asc, desc)

### wordpress_get_post

Get a single post by ID.

**Parameters:**
- `post_id` (required): The WordPress post ID

### wordpress_create_post

Create a new post with default TFOW taxonomy.

**Parameters:**
- `title` (required): Post title
- `content` (required): Post content in HTML
- `status`: Post status (default: draft)
- `categories`: Category IDs (default: [292] - Artificial Intelligence)
- `tags`: Tag IDs (default: [294, 295] - AI, Future of Work)
- `slug`: URL slug (auto-generated if not provided)
- `excerpt`: Post excerpt
- `featured_media`: Media ID for featured image
- `meta`: Custom meta fields

### wordpress_update_post

Update an existing post.

**Parameters:**
- `post_id` (required): The post ID to update
- All other parameters from create_post (only provided fields are updated)

### wordpress_delete_post

Delete or trash a post.

**Parameters:**
- `post_id` (required): The post ID to delete
- `force`: Permanently delete instead of trashing (default: false)

### wordpress_list_categories

List all categories.

**Parameters:**
- `per_page`: Number per page (default: 100)
- `page`: Page number
- `search`: Search term
- `hide_empty`: Hide categories with no posts

### wordpress_list_tags

List all tags.

**Parameters:**
- `per_page`: Number per page (default: 100)
- `page`: Page number
- `search`: Search term
- `hide_empty`: Hide tags with no posts

### wordpress_upload_media

Upload an image file for use as featured image.

**Parameters:**
- `file_path` (required): Local path to the image file
- `title`: Title for the media item
- `alt_text`: Alternative text for accessibility
- `caption`: Caption for the media item

## Default Taxonomy (TFOW Articles)

When creating posts without specifying categories or tags, these defaults are applied:

- **Category ID 292**: Artificial Intelligence
- **Tag ID 294**: AI
- **Tag ID 295**: Future of Work

## Usage Examples

### List recent published posts

```javascript
wordpress_list_posts({ status: "publish", per_page: 5 })
```

### Create a draft post

```javascript
wordpress_create_post({
  title: "The Future of AI in the Workplace",
  content: "<p>Article content here...</p>",
  status: "draft"
})
```

### Upload featured image and create post

```javascript
// First, upload the image
wordpress_upload_media({
  file_path: "/path/to/image.jpg",
  alt_text: "AI workplace illustration"
})
// Returns: { id: 12345, ... }

// Then create post with featured image
wordpress_create_post({
  title: "My Post",
  content: "<p>Content</p>",
  featured_media: 12345
})
```

## Troubleshooting

### Authentication Errors

1. Ensure application password is correct (spaces are removed automatically)
2. Verify username matches exactly
3. Check that REST API is not blocked by security plugins

### Media Upload Failures

1. Ensure the file path is absolute
2. Check file permissions
3. Verify file type is allowed by WordPress media settings

## Author

Larry G. Maguire - Human Performance

## Licence

MIT
