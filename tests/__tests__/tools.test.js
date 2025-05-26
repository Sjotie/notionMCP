import { jest } from '@jest/globals';

describe('Notion and Fireflies Tools', () => {
  let mockNotionClient;
  let mockFetch;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    // Mock console methods
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Mock Notion client methods
    mockNotionClient = {
      search: jest.fn(),
      databases: {
        query: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      },
      pages: {
        create: jest.fn(),
        update: jest.fn(),
        retrieve: jest.fn()
      },
      blocks: {
        retrieve: jest.fn(),
        update: jest.fn(),
        children: {
          list: jest.fn(),
          append: jest.fn()
        }
      }
    };

    // Mock fetch for Fireflies
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Mock the Notion client constructor
    jest.unstable_mockModule('@notionhq/client', () => ({
      Client: jest.fn().mockImplementation(() => mockNotionClient)
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('Notion Tools', () => {
    test('list-databases should return database list', async () => {
      const mockDatabases = {
        results: [
          { id: 'db1', title: [{ plain_text: 'Database 1' }], created_time: '2024-01-01' },
          { id: 'db2', title: [{ plain_text: 'Database 2' }], created_time: '2024-01-02' }
        ]
      };
      mockNotionClient.search.mockResolvedValue(mockDatabases);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', {}, mockNotionClient, null, 'test_user');

      expect(mockNotionClient.search).toHaveBeenCalledWith({
        filter: { property: 'object', value: 'database' },
        page_size: 100,
        sort: { direction: 'descending', timestamp: 'last_edited_time' }
      });
      expect(result.content[0].text).toContain('db1');
      expect(result.content[0].text).toContain('Database 1');
    });

    test('list-databases with concise flag should return summary', async () => {
      const mockDatabases = {
        results: [
          { 
            id: 'db1', 
            title: [{ plain_text: 'Database 1' }], 
            created_time: '2024-01-01',
            last_edited_time: '2024-01-02'
          }
        ]
      };
      mockNotionClient.search.mockResolvedValue(mockDatabases);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', { concise: true }, mockNotionClient, null, 'test_user');

      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult[0]).toEqual({
        id: 'db1',
        title: 'Database 1',
        created_time: '2024-01-01',
        last_edited_time: '2024-01-02'
      });
    });

    test('query-database should query with filters', async () => {
      const mockResults = { results: [{ id: 'page1' }] };
      mockNotionClient.databases.query.mockResolvedValue(mockResults);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('query-database', {
        database_id: 'db123',
        filter: { property: 'Status', select: { equals: 'Done' } },
        page_size: 50
      }, mockNotionClient, null, 'test_user');

      expect(mockNotionClient.databases.query).toHaveBeenCalledWith({
        database_id: 'db123',
        filter: { property: 'Status', select: { equals: 'Done' } },
        page_size: 50
      });
      expect(result.content[0].text).toContain('page1');
    });

    test('create-page should create a new page', async () => {
      const mockPage = { id: 'new-page-id', properties: {} };
      mockNotionClient.pages.create.mockResolvedValue(mockPage);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('create-page', {
        parent_id: 'db123',
        properties: { Title: { title: [{ text: { content: 'New Page' } }] } }
      }, mockNotionClient, null, 'test_user');

      expect(mockNotionClient.pages.create).toHaveBeenCalledWith({
        parent: { database_id: 'db123' },
        properties: { Title: { title: [{ text: { content: 'New Page' } }] } }
      });
      expect(result.content[0].text).toContain('new-page-id');
    });

    test('should handle tool errors gracefully', async () => {
      mockNotionClient.search.mockRejectedValue(new Error('API Error'));

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', {}, mockNotionClient, null, 'test_user');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error executing tool 'list-databases': API Error");
    });

    test('should handle unauthorized errors specially', async () => {
      const unauthorizedError = new Error('Unauthorized');
      unauthorizedError.code = 'unauthorized';
      mockNotionClient.search.mockRejectedValue(unauthorizedError);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', {}, mockNotionClient, null, 'test_user');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Authorization failed');
    });
  });

  describe('Fireflies Tools', () => {
    test('fireflies_list_transcripts should fetch transcript list', async () => {
      const mockTranscripts = {
        data: {
          transcripts: [
            { id: 't1', title: 'Meeting 1', dateString: '2024-01-01' },
            { id: 't2', title: 'Meeting 2', dateString: '2024-01-02' }
          ]
        }
      };
      mockFetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockTranscripts)
      });

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('fireflies_list_transcripts', 
        { limit: 10 }, 
        null, 
        'test_ff_token', 
        'test_user'
      );

      expect(mockFetch).toHaveBeenCalledWith('https://api.fireflies.ai/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_ff_token'
        },
        body: expect.stringContaining('limit: $limit')
      });
      expect(result.content[0].text).toContain('Meeting 1');
    });

    test('fireflies_list_transcripts with filters', async () => {
      const mockTranscripts = { data: { transcripts: [] } };
      mockFetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockTranscripts)
      });

      const { handleToolCall } = await import('../../utils/tools.js');
      await handleToolCall('fireflies_list_transcripts', {
        limit: 20,
        skip: 10,
        fromDate: '2024-01-01T00:00:00Z',
        toDate: '2024-01-31T23:59:59Z',
        participantEmail: 'test@example.com',
        organizerEmail: 'organizer@example.com',
        isMine: true
      }, null, 'test_ff_token', 'test_user');

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      
      expect(body.variables).toEqual({
        limit: 20,
        skip: 10,
        fromDate: '2024-01-01T00:00:00Z',
        toDate: '2024-01-31T23:59:59Z',
        participantEmail: 'test@example.com',
        organizerEmail: 'organizer@example.com',
        mine: true
      });
    });

    test('fireflies_get_transcript should fetch transcript details', async () => {
      const mockTranscript = {
        data: {
          transcript: {
            id: 't1',
            title: 'Meeting 1',
            speakers: [
              { id: 's1', name: 'Speaker 1' },
              { id: 's2', name: 'Speaker 2' }
            ],
            sentences: [
              { index: 0, speaker_id: 's1', text: 'Hello' },
              { index: 1, speaker_id: 's2', text: 'Hi there' }
            ]
          }
        }
      };
      mockFetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockTranscript)
      });

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('fireflies_get_transcript', 
        { transcript_id: 't1' }, 
        null, 
        'test_ff_token', 
        'test_user'
      );

      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual({
        title: 'Meeting 1',
        id: 't1',
        speakers_map: {
          's1': 'Speaker 1',
          's2': 'Speaker 2'
        },
        sentences: [
          ['s1', 'Hello'],
          ['s2', 'Hi there']
        ]
      });
    });

    test('should handle Fireflies API errors', async () => {
      mockFetch.mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          errors: [{ message: 'Invalid API token' }]
        })
      });

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('fireflies_list_transcripts', 
        {}, 
        null, 
        'invalid_token', 
        'test_user'
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Fireflies API Error: Invalid API token');
    });

    test('should require transcript_id for get_transcript', async () => {
      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('fireflies_get_transcript', 
        {}, 
        null, 
        'test_ff_token', 
        'test_user'
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('transcript_id is required');
    });
  });

  describe('Tool Output Formatting', () => {
    test('should truncate large outputs', async () => {
      // Create a large response
      const largeData = { data: Array(10000).fill('x').join('') };
      mockNotionClient.search.mockResolvedValue(largeData);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', {}, mockNotionClient, null, 'test_user');

      expect(result.content[0].text).toContain('Output was too long');
      expect(result.content[0].text.length).toBeLessThan(55000); // 50k + message
    });

    test('should handle undefined/null responses', async () => {
      mockNotionClient.search.mockResolvedValue(null);

      const { handleToolCall } = await import('../../utils/tools.js');
      const result = await handleToolCall('list-databases', {}, mockNotionClient, null, 'test_user');

      expect(result.content[0].text).toBe('');
    });
  });
});