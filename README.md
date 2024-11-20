# Bill Search API

A TypeScript-based API that performs semantic search on congressional bills using OpenAI embeddings and Supabase vector search.

## Setup

1. Clone the repository

2. Install dependencies

```bash
npm install
```

3. Configure environment variables
   Create a `.env` file in the root directory with:

```env
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

## Usage

Run the search script:

```bash
npm run search
```

Or with ts-node directly:

```bash
ts-node src/search.ts
```

## Features

- Semantic search using OpenAI embeddings
- Date-range filtering for bills
- Automatic retry on timeout
- Vector similarity search via Supabase

## Database Schema

The Supabase database includes a `bills` table with the following key fields:

- `package_id`: Unique identifier for the bill
- `title`: Bill title
- `date_issued`: Date the bill was issued
- `congress`: Congressional session
- `doc_class`: Document classification
- `embedding`: Vector embedding of bill content

## API Reference

### `search(query: string, startDate: string, endDate: string)`

Performs a semantic search on bills within the specified date range.

### `match_bills_by_date` (Supabase Function)

Stored procedure that handles vector similarity search with date filtering.
