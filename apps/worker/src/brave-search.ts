import fetch from 'node-fetch';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export class BraveSearch {
  constructor(private apiKey: string) {}

  async search(query: string, count: number = 5): Promise<SearchResult[]> {
    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
        {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Brave Search API error: ${response.status}`);
      }

      const data = await response.json() as any;

      if (!data.web?.results) {
        return [];
      }

      return data.web.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description,
        age: result.page_age
      }));

    } catch (error) {
      console.error('Brave search error:', error);
      return [];
    }
  }
}
