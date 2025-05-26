import { jest } from '@jest/globals';

describe('Fireflies Analyze Transcript Tool', () => {
  let mockFetch;
  let mockGoogleGenerativeAI;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    // Mock console methods
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Mock fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Mock Google Generative AI
    mockGoogleGenerativeAI = {
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn()
      })
    };

    jest.unstable_mockModule('@google/generative-ai', () => ({
      GoogleGenerativeAI: jest.fn().mockImplementation(() => mockGoogleGenerativeAI)
    }));

    // Mock environment variable
    process.env.GEMINI_API_KEY = 'test_gemini_key';
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    delete process.env.GEMINI_API_KEY;
  });

  test('should analyze transcript with Gemini successfully', async () => {
    const mockTranscript = {
      data: {
        transcript: {
          id: 't123',
          title: 'Team Meeting',
          sentences: [
            { speaker_name: 'John', text: 'Welcome everyone to the meeting.' },
            { speaker_name: 'Jane', text: 'Thanks for having us.' },
            { speaker_name: 'John', text: 'Let\'s discuss the Q4 results.' }
          ],
          speakers: [
            { name: 'John' },
            { name: 'Jane' }
          ]
        }
      }
    };

    const mockGeminiResponse = {
      response: {
        text: jest.fn().mockReturnValue('Based on the transcript, the meeting was about Q4 results discussion between John and Jane.')
      }
    };

    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue(mockTranscript)
    });

    mockGoogleGenerativeAI.getGenerativeModel().generateContent.mockResolvedValue(mockGeminiResponse);

    const { handleToolCall } = await import('../../utils/tools.js');
    
    const result = await handleToolCall(
      'fireflies_analyze_transcript',
      {
        transcript_id: 't123',
        prompt: 'What was the main topic of the meeting?'
      },
      null,
      'test_ff_token',
      'test_user'
    );

    // Verify Fireflies API was called
    expect(mockFetch).toHaveBeenCalledWith('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_ff_token'
      },
      body: expect.stringContaining('transcript_id')
    });

    // Verify Gemini was called with correct prompt
    const generateContentCall = mockGoogleGenerativeAI.getGenerativeModel().generateContent.mock.calls[0][0];
    expect(generateContentCall).toContain('You are tasked with answering questions');
    expect(generateContentCall).toContain('Team Meeting');
    expect(generateContentCall).toContain('John: Welcome everyone to the meeting.');
    expect(generateContentCall).toContain('What was the main topic of the meeting?');

    // Verify response
    const parsedResult = JSON.parse(result.content[0].text);
    expect(parsedResult).toEqual({
      transcript_id: 't123',
      transcript_title: 'Team Meeting',
      user_prompt: 'What was the main topic of the meeting?',
      analysis: 'Based on the transcript, the meeting was about Q4 results discussion between John and Jane.'
    });
  });

  test('should handle missing GEMINI_API_KEY', async () => {
    delete process.env.GEMINI_API_KEY;

    const { handleToolCall } = await import('../../utils/tools.js');
    
    const result = await handleToolCall(
      'fireflies_analyze_transcript',
      {
        transcript_id: 't123',
        prompt: 'What was discussed?'
      },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('GEMINI_API_KEY not found');
  });

  test('should handle missing required parameters', async () => {
    const { handleToolCall } = await import('../../utils/tools.js');
    
    // Missing prompt
    let result = await handleToolCall(
      'fireflies_analyze_transcript',
      { transcript_id: 't123' },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Both transcript_id and prompt are required');

    // Missing transcript_id
    result = await handleToolCall(
      'fireflies_analyze_transcript',
      { prompt: 'What was discussed?' },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Both transcript_id and prompt are required');
  });

  test('should handle Fireflies API errors', async () => {
    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        errors: [{ message: 'Transcript not found' }]
      })
    });

    const { handleToolCall } = await import('../../utils/tools.js');
    
    const result = await handleToolCall(
      'fireflies_analyze_transcript',
      {
        transcript_id: 'invalid_id',
        prompt: 'What was discussed?'
      },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error analyzing transcript: Transcript not found');
  });

  test('should handle Gemini API errors', async () => {
    const mockTranscript = {
      data: {
        transcript: {
          id: 't123',
          title: 'Meeting',
          sentences: [{ speaker_name: 'John', text: 'Hello' }]
        }
      }
    };

    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue(mockTranscript)
    });

    mockGoogleGenerativeAI.getGenerativeModel().generateContent.mockRejectedValue(
      new Error('Gemini API rate limit exceeded')
    );

    const { handleToolCall } = await import('../../utils/tools.js');
    
    const result = await handleToolCall(
      'fireflies_analyze_transcript',
      {
        transcript_id: 't123',
        prompt: 'Summarize'
      },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error analyzing transcript: Gemini API rate limit exceeded');
  });

  test('should handle empty transcript', async () => {
    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue({ data: { transcript: null } })
    });

    const { handleToolCall } = await import('../../utils/tools.js');
    
    const result = await handleToolCall(
      'fireflies_analyze_transcript',
      {
        transcript_id: 't123',
        prompt: 'What was discussed?'
      },
      null,
      'test_ff_token',
      'test_user'
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Transcript not found or empty');
  });
});