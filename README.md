# GŁOS Notes PWA

Instalowalna wersja GŁOS Notes dla iPhone'a i innych telefonów, bez certyfikatów Apple, TestFlight ani Maca.

Źródłem frontendu jest osobny projekt [GLOS-notes](https://github.com/xadrios-dev/GLOS-notes). Repozytorium PWA nie zawiera nagrań użytkowników ani ich kluczy API.

## Instalacja na iPhonie

1. Wejdź na **Settings → Pages** tego repozytorium.
2. W części **Build and deployment** ustaw **Source: GitHub Actions**, by włączyć GitHub Pages.
3. Otwórz **Actions → GŁOS Notes PWA · deploy**, wykonaj **Run workflow**. Wdrożenie uruchamia się też po zmianach na main.
4. Po sukcesie wejdź na adres pokazany w **Settings → Pages** przez **Safari** na iPhonie.
5. W Safari użyj **Udostępnij → Dodaj do ekranu początkowego → Dodaj**.
6. Uruchom aplikację GŁOS z ikony. Nadaj dostęp do mikrofonu przy pierwszym nagrywaniu.

Repozytorium jest prywatne. GitHub Pages dla prywatnych repozytoriów zależy od planu GitHuba. Jeśli nie możesz włączyć Pages, opublikuj katalog dist na innym hostingu HTTPS, np. Cloudflare Pages, albo świadomie zdecyduj o udostępnieniu kodu publicznie. Nie trzeba publikować nagrań ani danych, żeby witryna PWA działała.

## Co działa

- Notatki, edycja tekstu i Markdown, tagi, wyszukiwarka lokalna, zadania i motywy.
- Nagrywanie mikrofonem przy otwartej aplikacji, pauza, stop, odsłuch i dogrania, zależnie od wersji iOS i obsługi MediaRecorder.
- Import audio i zdjęć, eksport notatki Markdown.
- Lokalna baza IndexedDB, działanie interfejsu offline po pierwszym otwarciu i pobraniu cache aplikacji.
- Opcjonalne podsumowania, rozmowy AI oraz embeddingi przez API zgodne z OpenAI. Dostawca musi obsługiwać CORS i HTTPS. Klucz jest tylko w pamięci bieżącej sesji.
- Lokalny eksport i import ZIP zawierającego notatki, audio i zdjęcia. Import tworzy kopie, nie nadpisuje bieżących danych.

## Ograniczenia i bezpieczeństwo

- iOS może przerwać nagrywanie przy blokadzie ekranu, przełączeniu aplikacji lub zamknięciu PWA. Nie blokuj telefonu podczas nagrywania.
- Modele Whisper/Parakeet, Potion/Gemma, OCR offline, panel pływający i przypomnienia z Androida nie są jeszcze przeniesione do przeglądarki.
- Nie ma automatycznej synchronizacji urządzeń. Safari i aplikacja PWA mogą mieć osobne magazyny danych.
- Przeglądarka może usunąć pamięć witryny przy problemach z miejscem. Regularnie eksportuj ZIP do aplikacji Pliki lub prywatnego dysku.
- ZIP nie jest szyfrowany. Nie udostępniaj go osobom trzecim. Sprawdzaj, czy zapis pliku rzeczywiście zakończył się sukcesem.
- Service worker cache'uje wyłącznie publiczne pliki aplikacji i nie zapisuje w cache zapytań API ani danych prywatnych.
- Dla pracy z modelami AI klucz w sessionStorage jest przechowywany wyłącznie w danej sesji; nie zapisuje się w repozytorium.

## Uruchamianie lokalne

Wymagany Node.js 22 lub nowszy:

~~~sh
npm install
npm run check
npm run dev
npm run build
~~~

Serwer deweloperski działa pod http://localhost:8787. Na iPhonie PWA i mikrofon wymagają HTTPS. Katalog dist zawiera wszystkie potrzebne lokalne biblioteki oraz service worker z wersją zależną od commitu.

GitHub Actions buduje dist po zmianach na main i publikuje za pomocą GitHub Pages, jeżeli witryna jest włączona. W jobie build dostępny jest też osobny artefakt glos-notes-pwa-static-site, użyteczny do hostingu alternatywnego.
