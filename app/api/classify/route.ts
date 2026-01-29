import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie, setSessionCookie, clearSessionCookie, extractSessionCookie } from '@/lib/censusSession';

const CLASSIFY_ENDPOINT = 'https://uscensus.prod.3ceonline.com/ui/classify';

/**
 * Initialize a session by making a minimal request to get the ccce.key cookie
 */
async function initializeSession(): Promise<void> {
  // Make a minimal "start" request to establish session
  const initBody = {
    state: 'start',
    proddesc: '',
    lang: 'en',
    schedule: 'import/export',
    profileId: '57471f0c4ac2c9b910000000',
    username: 'NOT_SET',
    userData: 'NO_DATA_AVAIL',
    origin: 'US',
    destination: 'US',
    stopAtHS6: 'N',
  };
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Origin': 'https://uscensus.prod.3ceonline.com',
  };
  
  try {
    const initResponse = await fetch(CLASSIFY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(initBody),
    });
    
    const setCookieHeader = initResponse.headers.get('set-cookie') || initResponse.headers.get('Set-Cookie');
    if (setCookieHeader) {
      const extractedCookie = extractSessionCookie(setCookieHeader);
      if (extractedCookie) {
        setSessionCookie(extractedCookie);
      }
    }
  } catch {
    // Silently fail - will retry on next request
  }
}

async function makeCensusRequest(body: any): Promise<Response> {
  // Get stored session cookie
  let sessionCookie = getSessionCookie();
  
  // If no session cookie, try to initialize one
  if (!sessionCookie) {
    await initializeSession();
    sessionCookie = getSessionCookie();
  }
  
  // Build headers
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Origin': 'https://uscensus.prod.3ceonline.com',
  };
  
  // Build cookie header - ONLY send the Census API session cookie
  // Do NOT forward client cookies as they may interfere with the Census API
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }
  
  const response = await fetch(CLASSIFY_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  
  // Extract and store session cookie from response
  // Note: Set-Cookie headers can be an array, but response.headers.get() returns a comma-separated string
  // Try both lowercase and capitalized versions
  const setCookieHeader = response.headers.get('set-cookie') || response.headers.get('Set-Cookie');
  if (setCookieHeader) {
    const extractedCookie = extractSessionCookie(setCookieHeader);
    if (extractedCookie) {
      setSessionCookie(extractedCookie);
    }
  }
  
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Make request to Census API
    let response = await makeCensusRequest(body);
    
    // Check if response is OK and is JSON
    let contentType = response.headers.get('content-type');
    let isJson = contentType?.includes('application/json');

    // If we get 400/401, clear session and retry once
    if (!response.ok && (response.status === 400 || response.status === 401)) {
      clearSessionCookie();
      response = await makeCensusRequest(body);
      
      // Re-check content type after retry
      contentType = response.headers.get('content-type');
      isJson = contentType?.includes('application/json');
    }

    if (!response.ok) {
      // Try to get error message from response
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      if (isJson) {
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // If JSON parsing fails, read as text
          const text = await response.text();
          errorMessage = text.substring(0, 200); // Limit error message length
        }
      } else {
        // Read HTML/text error response
        const text = await response.text();
        errorMessage = `Non-JSON response: ${text.substring(0, 200)}`;
      }
      
      console.error('Census API Error:', {
        status: response.status,
        statusText: response.statusText,
        contentType,
        message: errorMessage,
      });

      return NextResponse.json(
        { 
          error: 'Failed to classify product',
          message: errorMessage,
          status: response.status
        },
        { status: response.status }
      );
    }

    // Get the response data
    if (!isJson) {
      const text = await response.text();
      console.error('Unexpected non-JSON response:', text.substring(0, 200));
      return NextResponse.json(
        { 
          error: 'Invalid response format',
          message: 'Expected JSON but received non-JSON response'
        },
        { status: 500 }
      );
    }

    // Parse JSON response
    let data;
    try {
      const responseText = await response.text();
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError);
      return NextResponse.json(
        { 
          error: 'Invalid response format',
          message: 'Failed to parse JSON response'
        },
        { status: 500 }
      );
    }

    // The Census API wraps responses in a 'data' property
    // Unwrap it to match what the frontend expects
    const responseData = data?.data || data;
    
    // Map API response fields to frontend expected format
    // The API uses 'currentQuestionInteraction' but frontend expects 'currentItemInteraction'
    if (responseData && !responseData.currentItemInteraction && responseData.currentQuestionInteraction) {
      responseData.currentItemInteraction = responseData.currentQuestionInteraction;
    }
    
    const nextResponse = NextResponse.json(responseData, { status: response.status });

    // Forward any Set-Cookie headers back to the client
    const setCookieHeaders = response.headers.get('set-cookie');
    if (setCookieHeaders) {
      nextResponse.headers.set('Set-Cookie', setCookieHeaders);
    }

    return nextResponse;
  } catch (error) {
    console.error('Census API Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to classify product',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
