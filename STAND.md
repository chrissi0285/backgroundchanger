# Wechselbild – belegter Stand und Abnahme

## Auftrag und Sicherheitsgrenze

Ziel ist eine eigenständig signierbare Nextcloud-App für Nextcloud 34 und PHP
8.5. Sie zeigt bei jedem neuen Seitenaufruf ein anderes ansprechendes
Online-Bild, liefert es aber aus einem kleinen lokalen Cache aus. Fällt das
Internet aus, bleiben die zuletzt erfolgreich geprüften Bilder verfügbar.

Unverändert bleiben Nextcloud-Core, andere Apps, Benutzerdateien, die
Nextcloud-Theming-Einstellungen und sämtliche produktiven Dienste. Die alte,
bereits deaktivierte App `unsplash` wird weder verändert noch gelöscht. Ihr
Identifier und ihre fremde Signatur werden nicht weiterverwendet.

## Belegter Ist-Zustand

- Produktiv läuft Nextcloud 34.0.3.2 mit PHP 8.5.4; Wartungsmodus ist aus und
  kein Datenbank-Upgrade ist offen.
- `unsplash` 3.1.0 ist deaktiviert, unverändert und mit gültiger offizieller
  Nextcloud-Signatur installiert. Laut `info.xml` unterstützt sie nur
  Nextcloud 26 bis 31 und PHP höchstens 8.4.
- Upstream `nextcloud/unsplash` hat nach 3.1.0 keinen Release veröffentlicht.
  Der Hauptzweig nennt sich bereits 3.2.0, unterstützt aber nur Nextcloud 31
  bis 33. Issue 176 bestätigt die fehlende Nextcloud-34-Kompatibilität.
- Der Upstream-Code fragt bei nicht gecachten Anbietern je CSS-Abruf bis zu
  drei externe Bilder ab. Wallhaven und Wikimedia werden direkt im Browser
  geladen. Der Unsplash-Zweig speichert zwar Dateien, verweist zur Anzeige
  aber weiterhin auf das entfernte Bild. Ein belastbarer Offline-Fallback
  existiert daher nicht.
- Der App-Store-Identifier `wechselbild` ist aktuell nicht belegt.

## Belegte Anbieterentscheidung

- Unsplash scheidet aus: Die offiziellen API-Regeln verlangen Hotlinking,
  Nutzungs-/Downloadmeldungen und Attribution und untersagen eine
  Wallpaper-App als Kernfunktion. Das widerspricht dem geforderten lokalen
  Offline-Cache.
- Bing scheidet aus: Der Upstream greift auf einen nicht offiziell als
  Drittanbieter-API dokumentierten Homepage-Endpunkt zu.
- Wallhaven scheidet aus: Die API ist dokumentiert, aber Wallhaven erklärt
  ausdrücklich, dass die Bilder Eigentum ihrer jeweiligen Urheber bleiben.
  Eine für diesen Cache allgemein verwertbare Bildlizenz wird nicht gewährt.
- Wikimedia Commons passt: Download und Cache sind unter der jeweiligen freien
  Dateilizenz erlaubt. Die App muss einen eindeutigen User-Agent senden,
  seriell und sparsam abrufen, Lastsignale beachten sowie Urheber, Quelle und
  Lizenz je Bild korrekt anzeigen.

## Verwendete Primärquellen

Zuletzt am 23. August 2026 gegen die aktuellen offiziellen Seiten und
Quellbäume geprüft:

- Nextcloud-34-Entwicklerhandbuch: [Upgrade auf 34](https://docs.nextcloud.com/server/latest/developer_manual/app_publishing_maintenance/app_upgrade_guide/upgrade_to_34.html),
  [App-Codesignierung](https://docs.nextcloud.com/server/stable/developer_manual/app_publishing_maintenance/code_signing.html),
  [HTTP-Client](https://docs.nextcloud.com/server/stable/developer_manual/digging_deeper/http_client.html),
  [AppData-Speicher](https://docs.nextcloud.com/server/stable/developer_manual/basics/storage/appdata.html),
  [Hintergrundjobs](https://docs.nextcloud.com/server/stable/developer_manual/basics/backgroundjobs.html)
  und [Controller-Sicherheit](https://docs.nextcloud.com/server/stable/developer_manual/basics/controllers.html).
- Offizieller Upstream: [`nextcloud/unsplash`](https://github.com/nextcloud/unsplash),
  [AGPL-Lizenz](https://github.com/nextcloud/unsplash/blob/main/LICENSE.md),
  [Issue 176 zu Nextcloud 34](https://github.com/nextcloud/unsplash/issues/176)
  und [PR 174](https://github.com/nextcloud/unsplash/pull/174). Der lokal
  geprüfte Hauptzweig stand auf Commit `80459ee`; Release 3.1.0 auf `670020e`.
- Anbieterbedingungen: [Unsplash-API-Regeln](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
  und [API-Nutzungsbedingungen](https://unsplash.com/api-terms),
  [Wallhaven-API](https://wallhaven.cc/help/api) und
  [Wallhaven-Bedingungen](https://wallhaven.cc/index.php/terms),
  [Commons-Nachnutzung](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en),
  [MediaWiki-API-Etikette](https://www.mediawiki.org/wiki/API:Etiquette/en)
  sowie die [Wikimedia-User-Agent-Regel](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy/en).

## Gewählte Architektur

- Eigener Identifier und Namensraum: `wechselbild` / `OCA\Wechselbild`.
- Quelle: ausschließlich die offizielle Commons-Kategorie
  `Featured pictures of landscapes` über die MediaWiki-API.
- Die App fordert feste 1920-Pixel-Vorschaubilder an. Größere Anforderungen
  würden bei Commons teils unnötige 3840-Pixel-Cachedateien ausliefern.
- Nur JPEG, PNG oder WebP, echte Landschaftsformate, HTTPS-Quellen und eine
  explizit erlaubte freie Lizenz werden angenommen. Antwortgröße, Bildsignatur,
  Abmessungen, Metadaten und Anbieter-Host werden geprüft.
- Nextclouds `IClientService` übernimmt Proxy-, TLS- und Schutzregeln. Die API
  erhält `maxlag`, Cache-Hinweise und einen eindeutigen App-User-Agent.
- Ein nicht parallel laufender, lastunempfindlicher Hintergrundjob aktualisiert
  höchstens alle sechs Stunden. Beim ersten Lauf werden vier Bilder aufgebaut,
  danach jeweils eines; maximal acht geprüfte Bilder bleiben erhalten.
- Bild und Metadaten werden erst vollständig geschrieben und erst dann zur
  Auswahl freigegeben. Bei Fehlern bleibt der vorherige Cache unangetastet.
- Browser erhalten nur gleichursprüngliche lokale URLs. Die kleine Auswahlliste
  wird nicht gecacht; in derselben Browser-Sitzung wird das vorige Bild
  ausgeschlossen. Bilder selbst sind über inhaltsgebundene Kennungen lange
  cachebar.
- Urheber, freie Lizenz und Commons-Quelldatei werden als kleine, bedienbare
  Einblendung angezeigt. Alle dynamischen Werte gelangen nur per `textContent`
  und gegen eine feste URL-Erlaubnisliste in die Seite.
- Benutzer mit einem ausdrücklich eigenen Nextcloud-Hintergrund werden nicht
  überschrieben. Ohne Bild bleibt ein lokaler CSS-Farbverlauf sichtbar.

## Beobachtbare Abnahmekriterien

1. App-ID, Ordner, Routen und PHP-Namensraum stimmen überein; keine Datei gibt
   sich als `unsplash` aus und keine fremde `signature.json` wird ausgeliefert.
2. XML-, PHP- und JavaScript-Syntax, Lizenzhinweise und Paketinhalt sind sauber;
   automatisierte Unit- und Fehlerfalltests bestehen.
3. Manipulierte Anbieterantworten, falsche Hosts, zu große oder ungültige
   Dateien und nicht erlaubte Lizenzen werden vor der Freigabe des jeweiligen
   Bildes verworfen; bestehende Cachebilder bleiben dabei lesbar. Parallele
   Hintergrundjobs sind gesperrt.
4. Ein isoliertes Nextcloud 34 mit PHP 8.5 kann die App installieren und
   aktivieren. Integritäts-, Cron-, Routen-, Login- und angemeldete Seitentests
   bestehen, ohne neue Nextcloud-Fehler zu erzeugen.
5. Mehrere echte Seitenwechsel zeigen nacheinander unterschiedliche lokale
   Bild-URLs; kein Browseraufruf geht an Wikimedia oder andere Bildanbieter.
6. Nach gesperrtem Internet funktionieren Login und angemeldete Seiten weiter
   und zeigen weiterhin ein zuletzt lokal gespeichertes Bild samt Attribution.
7. Die Darstellung wird bei Login, Dashboard und einer normalen App-Seite in
   Chromium visuell geprüft; Formulare, Navigation, Kontrast und Klickziele
   bleiben nutzbar.
8. Für `wechselbild` liegt ein eigener privater Schlüssel ausschließlich unter
   `/home/chrissi/llmo/secrets/`. Das Paket besteht die Nextcloud-
   Integritätsprüfung mit dem offiziellen, auf `wechselbild` begrenzten
   Zertifikat.
9. Erst danach wird produktiv installiert und aktiviert. Anschließend sind
   Nextcloud-Status, Core- und App-Integrität, Hintergrundjob, lokaler Cache,
   Login, angemeldete Seiten und frisches Nextcloud-Protokoll fehlerfrei.

## Letzter sicherer Checkpoint

Recherche, Architekturentscheidung, Quellstand und der vollständige isolierte
RUNI-Test sind abgeschlossen. Produktiv wurde nicht verändert.

- Der unprivilegierte Gast `wechselbild-nc34-test` lief mit `onboot=0`, Ubuntu
  26.04, PHP 8.5.4, MariaDB 11.8.6, Apache 2.4.66, Redis 8.0.5 und dem per
  SHA-256 und PGP geprüften Nextcloud 34.0.3.2.
- 36 Metadaten-/Identitätsprüfungen und 21 speicherinterne Cachetests sowie
  sämtliche PHP-, JavaScript-, XML-, Shell- und Paketprüfungen bestanden.
- Der erste reale Providerlauf zeigte, dass eine 2560-Pixel-Anforderung bei
  Commons teils 3840-Pixel-Dateien ausliefert. Die korrigierte feste
  1920-Pixel-Anforderung lieferte anschließend vier Initialbilder und weitere
  Einzelbilder ohne Zurückweisung. Die Begrenzung blieb bei acht sichtbaren
  Cacheeinträgen.
- Auswahl-, Bild-, 404-, 405-, Cache-Header-, Hintergrundjob-, Neustart- und
  Wiederanlauftests bestanden. Nach einem sauberen Logmarker entstanden bei
  erneutem echten Abruf keine Warnungen oder Fehler; die Core-Integrität blieb
  fehlerfrei.
- Ohne Standardroute war Commons nachweislich unerreichbar, Nextcloud samt
  Login, Auswahl und lokalen Bildern aber weiter nutzbar. Chrome zeigte bei
  Login, Dashboard und Dateien drei verschiedene Bilder und erzeugte fünf
  lokale Auswahl- sowie fünf lokale Bildabrufe, keinen Anbieteraufruf und
  keine JavaScript-Ausnahme. Die Screenshots wurden tatsächlich angesehen;
  Kontrast, Navigation, Formulare und Klickziele blieben nutzbar.
- Ein testweise gesetzter persönlicher Nextcloud-Hintergrund unterdrückte
  Wechselbild vollständig und ohne Netzaufruf. Der vorher nicht vorhandene
  Benutzerwert wurde danach wieder exakt gelöscht.

Der öffentliche Quellstand liegt unter
<https://github.com/chrissi0285/wechselbild>. Der DCO-geprüfte offizielle
Zertifikatsantrag ist [Nextcloud-PR 1181](https://github.com/nextcloud/app-certificate-requests/pull/1181).
Der private 4096-Bit-Schlüssel liegt ausschließlich mit Modus 600 unter
`/home/chrissi/llmo/secrets/wechselbild.key`. Solange Nextcloud den PR nicht
freigegeben hat, wird bewusst kein Paket als signiert ausgegeben und nichts
produktiv installiert.
