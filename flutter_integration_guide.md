# Flutter Integration Guide for DeutschFordisch

To connect your Flutter app to the enhanced backend, you'll need the [http](https://pub.dev/packages/http) package.

## 1. Project Setup
Add the dependency to your `pubspec.yaml`:
```yaml
dependencies:
  http: ^1.1.0
```

## 2. API Service Configuration
Create a file called `lib/services/api_service.dart` to handle all communication with the backend.

```dart
import 'dart:convert';
import 'dart:async';
import 'package:http/http.dart' as http;

class ApiService {
  // Use your Render URL for production
  static const String baseUrl = 'https://deutschfordisch-server.onrender.com';
  
  // Set explicit timeout to 30 seconds to handle server cold-starts
  static const Duration timeoutDuration = Duration(seconds: 30);

  // Helper method for authenticated requests with timeout
  static Future<http.Response> _getWithTimeout(String url) async {
    return http.get(Uri.parse(url)).timeout(
      timeoutDuration,
      onTimeout: () => throw TimeoutException('Server took too long to respond'),
    );
  }

  // 1. Dictionary Lookup
  static Future<Map<String, dynamic>?> lookupWord(String word) async {
    try {
      // Smart Direction: Just send simple params, backend will fix if wrong
      final url = '$baseUrl/dict?term=$word&from=de&to=en';
      final response = await _getWithTimeout(url);

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
    } catch (e) {
      print('Dictionary Error: $e');
    }
    return null;
  }

  // 2. AI Sentence Generation
  static Future<Map<String, dynamic>?> generateSentence(String word, String level) async {
    try {
      final url = '$baseUrl/sentence?word=$word&level=$level';
      final response = await _getWithTimeout(url);

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
    } catch (e) {
      print('AI Sentence Error: $e');
    }
    return null;
  }

  // 3. AI Translation Evaluation
  static Future<Map<String, dynamic>?> evaluateTranslation({
    required String original,
    required String translation,
    String level = 'A1',
    String from = 'de',
    String to = 'en',
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/evaluate'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'sentence': original,
          'translation': translation,
          'level': level,
          'from': from,
          'to': to,
        }),
      ).timeout(
        timeoutDuration,
        onTimeout: () => throw TimeoutException('Server took too long to respond'),
      );

      if (response.statusCode == 200) {
        return json.decode(response.body);
      }
    } catch (e) {
      print('AI Evaluation Error: $e');
    }
    return null;
  }
}
```

## 3. UI Implementation Example
Here is how you would use the service in a Flutter Widget:

```dart
void _onCheckTranslation() async {
  final result = await ApiService.evaluateTranslation(
    original: "Der Hund schläft.",
    translation: userInputValue,
  );

  if (result != null && result['success'] == true) {
    setState(() {
      feedback = result['feedback'];
      score = result['score'];
      correctTranslation = result['correct'];
    });
  } else {
    // Fallback to local logic if server is offline
    _showOfflineMessage();
  }
}
```

## 4. Best Practices for Accuracy & Performance

To ensure the best user experience and accurate data fetching:

- **Robust JSON Parsing**: Always check for the `success` flag first. For AI endpoints (`/sentence`, `/evaluate`), access the nested `data` object to get the primary results.
- **Request Timeouts**: Set a connection timeout of **30 seconds**. While the AI is fast (<2s), Render servers can take time to wake up (cold start), so a longer timeout prevents app exceptions.
- **Local Caching**: Cache dictionary results for the current session. If a user looks up "Haus" twice, the second result should come from a local `Map` or `box` (Hive) instead of a network call.
### Dictionary Lookup (`GET /dict`)
Retrieves translations for a word or phrase.

> [!TIP]
> **Smart Language Detection Active**
> The backend now automatically detects if you send English when it expects German (or vice versa). It will prioritize returning a valid translation even if the `from` and `to` parameters are accidentally swapped.

> [!IMPORTANT]
> **Recommended Parameters:**
> - For English -> German: `from=en&to=de`
> - For German -> English: `from=de&to=en`

**Parameters:**
- `term` (or `word`): The text to translate.
- `from`: Source language code (`en` or `de`).
- `to`: Target language code (`de` or `en`).
- **Debouncing Search**: If implementing a "search as you type" feature for the dictionary, add a 300-500ms debounce to avoid spamming the API with every keystroke.
- **Retry with Exponential Backoff**: For AI services, if you get a 500 or 429 error, wait 1 second before retrying. 
- **Graceful Fallbacks**: If the API fails, fall back to the local vocabulary list. Never block the user from navigating the app because of a network error.

- **Dictionary**: `?term=word&from=de&to=en`
- **Sentence**: `?word=word&level=A1` (or `?term=word`)

## 6. AI Learning Features (New)

### Start Practice Session (`GET /learn/practice`)
Generates practice content based on the selected mode.

**Parameters:**
- `type`: `en-de` (Written Translation) OR `de-en` (Multiple Choice).
- `level`: `A1` (default) to `C1`.

#### Mode A: Written Translation (`type=en-de`)
The user is given an English sentence and must write the German translation. You then send their input to `/evaluate`.

**Response:**
```json
{
  "success": true,
  "data": {
    "question": "The dog sleeps.",
    "context": "General statement"
  }
}
```

#### Mode B: Multiple Choice (`type=de-en`)
The user is given a German sentence and must select the correct English translation from 4 options.

**Response:**
```json
{
  "success": true,
  "data": {
    "question": "Der Hund schläft.",
    "options": ["The dog runs.", "The dog sleeps.", "The cat sleeps.", "The dog barks."],
    "answer": "The dog sleeps.",
    "explanation": "Der Hund means 'The dog' and schläft means 'sleeps'."
  }
}
```

### AI Vocabulary Maturity (New)
The backend now tracks the "maturity" of individual words based on your lookups. Use these fields to enhance your UI:

- `already_in_vocab` (bool): If `true`, the word was served from the local cache. You can use this to show a "Known Word" badge or skip redundant UI animations.
- `hit_count` (int): Number of times the word has been queried.
- `last_queried` (string): ISO timestamp of the last lookup.
- `is_vocab` (bool): Always `true` for successful lookups, signifying the word is now part of the user's "Enhanced Vocabulary".

### Smart Dictionary Behavior
- **Direction-Agnostic Caching**: If you look up a German word in an "EN -> DE" session, the backend will still find it in the cache if it exists as a "DE -> EN" entry. This ensures the local vocabulary is always prioritized.
- **Fail-Safe Validation**: The API now specifically validates AI responses. If the AI fails to produce a valid translation, you will receive a clean `500` error with a descriptive message instead of empty data.
