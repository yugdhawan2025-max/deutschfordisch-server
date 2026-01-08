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
import 'package:http/http.dart' as http;

class ApiService {
  // Use your Render URL for production
  static const String baseUrl = 'https://deutschfordisch-server.onrender.com';

  // 1. Dictionary Lookup
  static Future<Map<String, dynamic>?> lookupWord(String word) async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/dict?term=$word&from=de&to=en'),
      );

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
      final response = await http.get(
        Uri.parse('$baseUrl/sentence?word=$word&level=$level'),
      );

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
- **Request Timeouts**: AI models can take 2-5 seconds. Set a connection timeout of at least 10 seconds in your `http` client to avoid unexpected app freezes.
- **Local Caching**: Cache dictionary results for the current session. If a user looks up "Haus" twice, the second result should come from a local `Map` or `box` (Hive) instead of a network call.
### Dictionary Lookup (`GET /dict`)
Retrieves translations for a word or phrase.

> [!IMPORTANT]
> **Check your `from` and `to` parameters!**
> - For English -> German: `from=en&to=de`
> - For German -> English: `from=de&to=en`
> If these are swapped, the API may return the same word you searched for.

**Parameters:**
- `term` (or `word`): The text to translate.
- `from`: Source language code (`en` or `de`).
- `to`: Target language code (`de` or `en`).
- **Debouncing Search**: If implementing a "search as you type" feature for the dictionary, add a 300-500ms debounce to avoid spamming the API with every keystroke.
- **Retry with Exponential Backoff**: For AI services, if you get a 500 or 429 error, wait 1 second before retrying. 
- **Graceful Fallbacks**: If the API fails, fall back to the local vocabulary list. Never block the user from navigating the app because of a network error.

## 5. Parameter Flexibility
The backend now supports both `word` and `term` as parameters for consistency. 
- **Dictionary**: `?term=word&from=de&to=en`
- **Sentence**: `?word=word&level=A1` (or `?term=word`)
