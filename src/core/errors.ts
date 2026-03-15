export class ScraperError extends Error {
  constructor(message: string, readonly code = 'SCRAPER_ERROR') {
    super(message);
    this.name = 'ScraperError';
  }
}

export class ChromeConnectionError extends ScraperError {
  constructor(message: string) {
    super(message, 'CHROME_CONNECTION_ERROR');
    this.name = 'ChromeConnectionError';
  }
}

export class ExtractionError extends ScraperError {
  constructor(message: string) {
    super(message, 'EXTRACTION_ERROR');
    this.name = 'ExtractionError';
  }
}
