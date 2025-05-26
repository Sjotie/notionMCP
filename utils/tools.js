import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

export function formatToolOutput(responseData, currentToolName, userToken) {
  const toolLogPrefix = `[${userToken || 'tools/call'}:${currentToolName || 'unknown_tool'}]`;
  let outputText;
  try {
    if (responseData === undefined || responseData === null) {
      console.warn(`${toolLogPrefix} Response data is undefined or null. Returning empty string content.`);
      return { content: [{ type: "text", text: "" }] };
    }
    outputText = JSON.stringify(responseData, null, 2);
  } catch (stringifyError) {
    console.error(`${toolLogPrefix} Error stringifying responseData:`, stringifyError);
    return { isError: true, content: [{ type: "text", text: "Internal Server Error: Could not serialize tool output." }] };
  }

  const maxLength = 50000;
  if (outputText.length > maxLength) {
    const originalLength = outputText.length;
    const truncatedText = outputText.substring(0, maxLength);
    const truncationMessage = `Output was too long: total ${originalLength}. Truncated to 50.000 characters.\n`;
    console.warn(`${toolLogPrefix} Output truncated. Original length: ${originalLength}, new length: ${maxLength}.`);
    return { content: [{ type: "text", text: truncationMessage + truncatedText }] };
  } else {
    return { content: [{ type: "text", text: outputText }] };
  }
}

export async function handleToolCall(name, args, notionClient, firefliesToken, userToken) {
  const logPrefix = `[${userToken || 'tools/call'}:${name}]`;
  
  try {
    // Notion Tools
    if (name === "list-databases") {
      const concise = args && typeof args.concise === "boolean" ? args.concise : false;
      const response = await notionClient.search({ 
        filter: { property: "object", value: "database" }, 
        page_size: 100, 
        sort: { direction: "descending", timestamp: "last_edited_time" } 
      });
      
      if (concise) {
        const conciseResults = response.results.map(db => ({
          id: db.id,
          title: db.title && Array.isArray(db.title) && db.title.length > 0
            ? (db.title[0].plain_text || db.title[0].text?.content || "")
            : "",
          created_time: db.created_time,
          last_edited_time: db.last_edited_time
        }));
        return formatToolOutput(conciseResults, name, userToken);
      } else {
        return formatToolOutput(response.results, name, userToken);
      }
    }
    else if (name === "query-database") {
      const { database_id, filter, sorts, start_cursor, page_size } = args || {};
      if (!database_id) {
        return { isError: true, content: [{ type: "text", text: "Error: database_id is required for query-database."}] };
      }
      const queryParams = { database_id, page_size: page_size || 100, filter, sorts, start_cursor };
      Object.keys(queryParams).forEach(key => queryParams[key] === undefined && delete queryParams[key]);
      const response = await notionClient.databases.query(queryParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "create-page") {
      const { parent_id, properties, children } = args || {};
      const pageParams = { parent: { database_id: parent_id }, properties };
      if (children) pageParams.children = children;
      const response = await notionClient.pages.create(pageParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "update-page") {
      const { page_id, properties, archived } = args || {};
      const updateParams = { page_id, properties };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionClient.pages.update(updateParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "create-database") {
      let { parent_id, title, properties, icon, cover } = args || {};
      parent_id = parent_id.replace(/-/g, "");
      const databaseParams = { parent: { type: "page_id", page_id: parent_id }, title, properties };
      if (icon && icon.type === "emoji" && !icon.emoji) {
        icon.emoji = "";
        databaseParams.icon = icon;
      } else if (icon) {
        databaseParams.icon = icon;
      }
      if (cover) databaseParams.cover = cover;
      const response = await notionClient.databases.create(databaseParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "update-database") {
      const { database_id, title, description, properties: db_properties } = args || {};
      const updateParams = { database_id };
      if (title !== undefined) updateParams.title = title;
      if (description !== undefined) updateParams.description = description;
      if (db_properties !== undefined) updateParams.properties = db_properties;
      const response = await notionClient.databases.update(updateParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "get-page") {
      let { page_id } = args || {};
      page_id = page_id.replace(/-/g, "");
      const response = await notionClient.pages.retrieve({ page_id });
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "get-block-children") {
      let { block_id, start_cursor, page_size } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, page_size: page_size || 100 };
      if (start_cursor) params.start_cursor = start_cursor;
      const response = await notionClient.blocks.children.list(params);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "append-block-children") {
      let { block_id, children, after } = args || {};
      block_id = block_id.replace(/-/g, "");
      const params = { block_id, children };
      if (after) params.after = after.replace(/-/g, "");
      const response = await notionClient.blocks.children.append(params);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "update-block") {
      let { block_id, block_type, content, archived } = args || {};
      block_id = block_id.replace(/-/g, "");
      const updateParams = { block_id, [block_type]: content };
      if (archived !== undefined) updateParams.archived = archived;
      const response = await notionClient.blocks.update(updateParams);
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "get-block") {
      let { block_id } = args || {};
      block_id = block_id.replace(/-/g, "");
      const response = await notionClient.blocks.retrieve({ block_id });
      return formatToolOutput(response, name, userToken);
    }
    else if (name === "search") {
      const { query, filter, sort, start_cursor, page_size } = args || {};
      const searchParams = { query: query || "", page_size: page_size || 100 };
      if (filter) searchParams.filter = filter;
      if (sort) searchParams.sort = sort;
      if (start_cursor) searchParams.start_cursor = start_cursor;
      const response = await notionClient.search(searchParams);
      return formatToolOutput(response, name, userToken);
    }
    
    // Fireflies Tools
    else if (name === "fireflies_list_transcripts") {
      if (!firefliesToken) {
        return { isError: true, content: [{ type: "text", text: "Authorization Error: Fireflies API Token not configured for your session token." }] };
      }
      
      const {
        limit = 20,
        skip,
        fromDate,
        toDate,
        participantEmail,
        organizerEmail,
        isMine
      } = args || {};

      const gqlVariables = { limit: parseInt(limit, 10) > 50 ? 50 : parseInt(limit, 10) };
      if (skip !== undefined) gqlVariables.skip = parseInt(skip, 10);
      if (fromDate) gqlVariables.fromDate = fromDate;
      if (toDate) gqlVariables.toDate = toDate;
      if (participantEmail) gqlVariables.participantEmail = participantEmail;
      if (organizerEmail) gqlVariables.organizerEmail = organizerEmail;
      if (typeof isMine === 'boolean') gqlVariables.mine = isMine;

      let variableDefinitions = "$limit: Int";
      if (gqlVariables.skip !== undefined) variableDefinitions += ", $skip: Int";
      if (gqlVariables.fromDate) variableDefinitions += ", $fromDate: DateTime";
      if (gqlVariables.toDate) variableDefinitions += ", $toDate: DateTime";
      if (gqlVariables.participantEmail) variableDefinitions += ", $participantEmail: String";
      if (gqlVariables.organizerEmail) variableDefinitions += ", $organizerEmail: String";
      if (gqlVariables.mine !== undefined) variableDefinitions += ", $mine: Boolean";
      
      let queryArguments = "limit: $limit";
      if (gqlVariables.skip !== undefined) queryArguments += ", skip: $skip";
      if (gqlVariables.fromDate) queryArguments += ", fromDate: $fromDate";
      if (gqlVariables.toDate) queryArguments += ", toDate: $toDate";
      if (gqlVariables.participantEmail) queryArguments += ", participant_email: $participantEmail";
      if (gqlVariables.organizerEmail) queryArguments += ", organizer_email: $organizerEmail";
      if (gqlVariables.mine !== undefined) queryArguments += ", mine: $mine";

      const gql = `
        query ListTranscripts(${variableDefinitions}) {
          transcripts(${queryArguments}) {
            id
            title
            dateString
            participants
            organizer_email
          }
        }`;
      
      const body = JSON.stringify({ query: gql, variables: gqlVariables });

      const resp = await fetch("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${firefliesToken}`
        },
        body
      });
      
      const json = await resp.json();
      if (json.errors) {
        console.error(`${logPrefix} Fireflies GQL Errors:`, json.errors);
        throw new Error(json.errors.map(e => e.message).join("; "));
      }
      return formatToolOutput(json.data.transcripts, name, userToken);
    }
    else if (name === "fireflies_get_transcript") {
      if (!firefliesToken) {
        return { isError: true, content: [{ type: "text", text: "Authorization Error: Fireflies API Token not configured for your session token." }] };
      }
      
      const { transcript_id } = args || {};
      if (!transcript_id) {
        return { isError: true, content: [{ type: "text", text: "Error: transcript_id is required." }] };
      }

      const gql = `
        query TranscriptDetails($id:String!){
          transcript(id:$id){
            id title
            sentences{index speaker_name speaker_id text}
            speakers{id name}
          }
        }`;
      const body = JSON.stringify({ query: gql, variables: { id: transcript_id } });

      const resp = await fetch("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${firefliesToken}`
        },
        body
      });
      
      const json = await resp.json();
      if (json.errors) throw new Error(json.errors[0].message);

      const originalTranscriptData = json.data.transcript;
      if (!originalTranscriptData) {
        return formatToolOutput({ message: "Transcript not found or empty." }, name, userToken);
      }

      const speakersMap = {};
      if (originalTranscriptData.speakers && Array.isArray(originalTranscriptData.speakers)) {
        originalTranscriptData.speakers.forEach(speaker => {
          if (speaker && speaker.id && speaker.name) {
            speakersMap[speaker.id] = speaker.name;
          }
        });
      }

      const leanSentences = originalTranscriptData.sentences ? originalTranscriptData.sentences.map(sentence => ([
        sentence.speaker_id,
        sentence.text
      ])) : [];

      const optimizedResponse = {
        title: originalTranscriptData.title,
        id: originalTranscriptData.id,
        speakers_map: speakersMap,
        sentences: leanSentences
      };

      return formatToolOutput(optimizedResponse, name, userToken);
    }
    else if (name === "fireflies_analyze_transcript") {
      if (!firefliesToken) {
        return { isError: true, content: [{ type: "text", text: "Authorization Error: Fireflies API Token not configured for your session token." }] };
      }
      
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        return { isError: true, content: [{ type: "text", text: "Configuration Error: GEMINI_API_KEY not found in environment variables." }] };
      }
      
      const { transcript_id, prompt } = args || {};
      
      if (!transcript_id || !prompt) {
        return { isError: true, content: [{ type: "text", text: "Error: Both transcript_id and prompt are required." }] };
      }

      try {
        // First, fetch the full transcript
        const gql = `
          query TranscriptDetails($id:String!){
            transcript(id:$id){
              id title
              sentences{speaker_name text}
              speakers{name}
            }
          }`;
        const body = JSON.stringify({ query: gql, variables: { id: transcript_id } });

        const resp = await fetch("https://api.fireflies.ai/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${firefliesToken}`
          },
          body
        });
        
        const json = await resp.json();
        if (json.errors) throw new Error(json.errors[0].message);

        const transcriptData = json.data.transcript;
        if (!transcriptData) {
          return { isError: true, content: [{ type: "text", text: "Transcript not found or empty." }] };
        }

        // Format the transcript for Gemini
        let formattedTranscript = `Title: ${transcriptData.title}\n\n`;
        if (transcriptData.sentences && transcriptData.sentences.length > 0) {
          transcriptData.sentences.forEach(sentence => {
            formattedTranscript += `${sentence.speaker_name}: ${sentence.text}\n`;
          });
        }

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });

        // Create the prompt for Gemini
        const systemPrompt = `You are tasked with answering questions or providing answers based ONLY on the following transcript and nothing else. Be complete, if in doubt, provide more information than was asked for.

<transcript>
${formattedTranscript}
</transcript>

User question: ${prompt}`;

        console.log(`${logPrefix} Analyzing transcript ${transcript_id} with Gemini`);
        
        // Generate response using Gemini
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const analysisText = response.text();

        return formatToolOutput({
          transcript_id: transcript_id,
          transcript_title: transcriptData.title,
          user_prompt: prompt,
          analysis: analysisText
        }, name, userToken);

      } catch (e) {
        console.error(`${logPrefix} Error analyzing transcript:`, e);
        return { isError: true, content: [{ type: "text", text: `Error analyzing transcript: ${e.message}` }] };
      }
    }
    
    // Unknown tool
    else {
      console.error(`${logPrefix} Unknown tool or tool not available for this user.`);
      return { isError: true, content: [{ type: "text", text: `Tool '${name}' not found or not available for your current user context.` }] };
    }
    
  } catch (error) {
    let errorMessage = `Error executing tool '${name}': ${error.message}`;
    if (error.code === 'unauthorized' || (error.body && typeof error.body === 'string' && error.body.includes('unauthorized')) || (error.body && typeof error.body === 'object' && error.body.code === 'unauthorized')) {
      errorMessage = `Notion API Error for '${name}': Authorization failed. The API Key for your session may be invalid or lack necessary permissions.`;
    } else if (name.startsWith('fireflies_')) {
      errorMessage = `Fireflies API Error: ${error.message}`;
    }
    return { isError: true, content: [{ type: "text", text: errorMessage }] };
  }
}