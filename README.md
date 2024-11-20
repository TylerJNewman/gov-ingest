# Congressional Bill Data Loader

A collection of TypeScript scripts for loading and searching congressional bills using OpenAI embeddings and Supabase vector storage.

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
SUPABASE_ANON_KEY=your_supabase_key
GOV_INFO_API_KEY=your_govinfo_key
```

## Scripts

### Data Loading

```bash
# Load bills into database
npm run sync

# Watch mode for development
npm run sync:watch
```

### Search

```bash
# Search bills
npm run search

# Watch mode for development
npm run search:watch
```

## Features

- Loads congressional bills from GovInfo API
- Generates embeddings using OpenAI
- Stores bills and embeddings in Supabase
- Vector similarity search capabilities
- Date-range filtering
- Automatic retry logic for API failures

## Database Schema

The Supabase database includes a `bills` table with the following fields:

- `package_id`: Unique identifier for the bill
- `title`: Bill title
- `date_issued`: Date the bill was issued
- `congress`: Congressional session
- `doc_class`: Document classification
- `embedding`: Vector embedding of bill content

## Stored Procedures

### `match_bills_by_date`

Performs vector similarity search with date range filtering.

Parameters:

- `query_embedding`: Vector to match against
- `match_threshold`: Minimum similarity threshold
- `match_count`: Maximum number of results
- `start_date`: Start of date range
- `end_date`: End of date range
