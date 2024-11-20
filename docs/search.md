markdown:docs/search.md

# Searching Congressional Bills

This document explains how to use the search functionality to find relevant congressional bills.

## Basic Usage

The search function allows you to find bills by semantic similarity using OpenAI embeddings. You can search within a specific date range.

```typescript
// Example: Search for healthcare-related bills from 2023
await search('healthcare reform', '2023-01-01', '2023-12-31');
```

## Search Parameters

- `query` (string): The search topic or phrase
- `startDate` (string): Start date in YYYY-MM-DD format
- `endDate` (string): End date in YYYY-MM-DD format

## Results Format

Each result includes:

- `package_id`: Unique identifier for the bill
- `title`: Bill title
- `date_issued`: When the bill was issued
- `congress`: Congressional session
- `doc_class`: Document classification
- `similarity`: Similarity score (0-1)

## Example Queries

```typescript
// Healthcare bills from 2023
await search('healthcare reform', '2023-01-01', '2023-12-31');

// Environmental legislation
await search('climate change', '2022-01-01', '2023-12-31');

// Technology policy
await search('artificial intelligence', '2019-01-01', '2024-03-19');
```

## Configuration

The search uses:

- Similarity threshold: 0.7 (70% match minimum)
- Results limit: 10 bills
- Automatic retry on timeout (max 3 attempts)
