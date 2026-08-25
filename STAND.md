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

## Signierter Freigabestand

[Nextcloud-PR 1181](https://github.com/nextcloud/app-certificate-requests/pull/1181)
ist freigegeben und zusammengeführt. Das ausgestellte Zertifikat ist auf den
eigenen Identifier `wechselbild` begrenzt:

- Betreff: `CN=wechselbild`
- Aussteller: `Nextcloud Code Signing Intermediate Authority`
- SHA-256-Fingerabdruck:
  `EF:96:9E:0E:FB:99:DA:11:CB:91:B3:AB:D1:07:1C:22:EB:1B:43:AE:CB:08:52:02:62:2B:0B:F3:85:A8:85:07`
- Der private 4096-Bit-Schlüssel liegt ausschließlich mit Modus 600 unter
  `/home/chrissi/llmo/secrets/wechselbild.key`. Er wurde weder nach RUNI noch
  auf die produktive Nextcloud kopiert und ist nicht Bestandteil von Git,
  Paket, Protokoll oder Bildschirmbeleg.

Die signierten Laufzeitpakete enthalten jeweils genau 19 Dateien: 18
Laufzeitdateien und `appinfo/signature.json`, aber keine Tests, Git-Daten,
Arbeitsdokumente, Zertifikatsanträge oder Schlüssel.

- `build/wechselbild-1.0.0-signed.tar.gz`:
  SHA-256 `1f5d443e4041376a164797aafca500c179f564158809158a4cbbf01fa7a5a212`
- `build/wechselbild-1.0.1-signed.tar.gz`:
  SHA-256 `051bd26d9000ee668bc2f12cb6dba5aef538de57aad3a49c5196722d74375f4d`

Version 1.0.1 ist der kleinste notwendige Nachtrag. Ein Regressionstest gegen
die signierte 1.0.0 reproduzierte bei drei Navigationen fünf statt drei
Auswahlabrufe. Ursache war ein sofortiger Aufruf zusammen mit dem späteren
`pageshow`-Ereignis. Commit `d065845` entfernt nur den doppelten Erstaufruf;
danach erzeugen drei Seiten exakt drei Auswahl- und drei Bildabrufe.

## Isolierte Abnahme auf RUNI

Der vollständige Freigabepfad wurde vor Produktion in Gast 102
`wechselbild-nc34-signed-test` geprüft. Der Gast war unprivilegiert, hatte
`onboot=0` und lief mit Nextcloud 34.0.3.2, Ubuntu 26.04, PHP 8.5.4,
Apache 2.4.66, MariaDB 11.8.6 und Redis 8.0.5.

- 36 Unit-/Identitätsprüfungen, 21 speicherinterne Cacheprüfungen sowie alle
  PHP-, JavaScript-, XML-, Shell-, Paket- und Geheimnisprüfungen bestanden.
- Nextcloud akzeptierte sowohl die Neuinstallation als auch das offizielle
  Update auf 1.0.1. Core- und App-Integrität blieben sauber.
- Der echte Commons-Lauf hielt den Cache bei höchstens acht geprüften Bildern;
  Routen, 404/405-Verhalten, MIME-Typen und Cache-Header stimmten.
- Mit entfernter Standardroute war Wikimedia unerreichbar. Login, Dashboard
  und Dateien zeigten weiterhin drei verschiedene lokale Bilder mit genau
  drei Auswahl- und drei Bildabrufen, null Anbieterabrufen und null
  JavaScript-Ausnahmen. Die Offline-Screenshots wurden visuell geprüft.
- Ein persönlicher Nextcloud-Hintergrund unterdrückte Wechselbild vollständig.
  Der zuvor nicht vorhandene Benutzerwert wurde danach wieder exakt entfernt.
- Der vollständige Rückweg auf die signierte 1.0.0 und das erneute offizielle
  Update auf 1.0.1 bestanden. Dabei wurde belegt, dass neben dem atomaren
  Dateitausch auch `installed_version=1.0.0` gesetzt werden muss; ein bloßer
  Code-Rücktausch würde Nextcloud sonst zu Recht als ausstehendes Upgrade
  behandeln.
- Nach einem Gastneustart bestanden Status, Dienste, Integrität, Cache,
  Hintergrundjob und Webzugriff erneut. Der abschließend abgegrenzte
  Logabschnitt enthielt keine Warnung und keinen Fehler.

Gast 102 wurde nach erneuter Endprüfung geordnet gestoppt und mit seiner
Konfiguration, dem Haupt-LV und dem Test-Snapshot-LV gelöscht. Der ausschließlich
zugehörige Transferordner und das Ubuntu-Template wurden entfernt. RUNI wurde
danach über `systemctl poweroff` heruntergefahren und war nach sechs Prüfungen
nicht mehr per SSH erreichbar. CT2099 und andere Gäste wurden nicht betreten,
geprüft oder einzeln gestoppt.

## Produktiver Stand vom 25. August 2026

Wechselbild 1.0.1 ist auf der produktiven Nextcloud aktiviert. Die alte App
`unsplash` bleibt unverändert und deaktiviert auf 3.1.0; sie wurde weder
gelöscht noch umsigniert.

- Nextcloud meldet 34.0.3.2, `maintenance: false` und
  `needsDbUpgrade: false`. Der vom offiziellen `occ upgrade` vorübergehend
  gesetzte Wartungsmodus wurde von diesem wieder aufgehoben und anschließend
  mehrfach unabhängig geprüft.
- Apache, MariaDB und Redis sind aktiv; es gibt keine fehlgeschlagene
  systemd-Einheit. `/mnt/ceds` ist lesbar als vorgesehene NFS-4.2-Freigabe
  `172.16.0.24:/ceds` eingebunden.
- Aktiver Code, registrierte und deklarierte Version sind 1.0.1. Der aktive
  Baum ist über alle 19 Dateien bytegleich zum signierten 1.0.1-Paket.
  Nextclouds Core-, Wechselbild-, `logcleaner`- und `unsplash`-
  Integritätsprüfungen bestehen.
- Genau ein Job `OCA\Wechselbild\Cron\RefreshBackgrounds` ist registriert.
  Seine erzwungene produktive Probe lief in zwei Sekunden, ergänzte genau ein
  Bild und setzte den nächsten Lauf auf 06:46 UTC. Dabei entstanden weder
  Nextcloud-Warnung noch Apache-Fehler.
- Der AppData-Cache enthält danach sechs Metadaten-/Bildpaare. IDs,
  SHA-256-Werte, MIME-Typen, Abmessungen, Landschaftsformat, Dateizuordnung,
  Commons-Quelle und Creative-Commons-Lizenz stimmen; es gibt kein verwaistes
  Bild.
- Login, lokale Auswahl und lokales Bild liefern HTTP 200. Die Auswahl ist
  `no-store`; das Bild ist `public, max-age=604800, immutable`. Der gelieferte
  Bildhash stimmt bytegenau mit den AppData-Metadaten überein. Im dazu frisch
  abgegrenzten Nextcloud- und Apache-Protokoll entstanden null Warnungen,
  null `logcleaner`-Routenfehler und null Apache-Fehler.
- Ein isolierter Chromium-Lauf gegen die Produktion lud drei anonyme
  Loginseiten mit drei verschiedenen IDs, exakt drei lokalen Auswahl- und
  drei lokalen Bildabrufen, null Anbieterabrufen und null JavaScript-Ausnahmen.

Die auf Produktion kopierten Archive und der alte Bereitstellungsmarker unter
`/var/tmp` wurden nach Hash-, Pfad- und Benutzungsprüfung entfernt. Als
unmittelbarer Rückweg bleibt
`/var/www/nextcloud/apps/.wechselbild-1.0.0-rollback` erhalten. Dieser Baum ist
über alle 19 Dateien bytegleich zum signierten 1.0.0-Paket, enthält keine
Datenbankdefinition und wird von Nextcloud nicht als zweite App registriert.

Der geprüfte Rückweg lautet: Wartungsmodus einschalten und verifizieren,
`installed_version` auf 1.0.0 setzen, den aktiven 1.0.1-Baum rücksetzbar
beiseiteschieben, den geprüften 1.0.0-Baum atomar an die aktive Stelle setzen,
`occ upgrade --no-interaction` ausführen und erst nach Status-, Dienst-, NFS-,
Integritäts- und Webprüfung den Wartungsmodus wieder ausschalten. Bei einem
Fehler wird der Dateitausch umgekehrt und `installed_version` wieder auf 1.0.1
gesetzt. Dieser vollständige Ablauf wurde auf RUNI ausgeführt; auf Produktion
wurde er wegen des fehlerfreien 1.0.1-Zustands nicht unnötig ausgelöst.

## Unerwartetes `logcleaner`-Update

Der offizielle Nextcloud-Updater aktualisierte während `occ upgrade`
automatisch die bereits aktivierte App `logcleaner` von 1.5.8 auf 1.5.9. Das
ist durch die Core-Logik `upgradeAppStoreApps`, die Updater-Ereignisse und den
vorher/nachher gebildeten App-Inventarhash belegt. Wird im aktuellen Inventar
nur `logcleaner` wieder als 1.5.8 eingesetzt, entsteht exakt der Vorabhash;
keine weitere fremde App änderte ihre Version.

1.5.9 wurde am selben Tag offiziell veröffentlicht. Der Upstream-Vergleich
1.5.8…1.5.9 umfasst sechs Dateien und ersetzt dynamische Shellbefehle in
`Helper.php` und `LogsController.php` durch PHP-Dateioperationen, reduziert
den Speicherbedarf beim Zeilenzählen und repariert das Einstellungsmenü unter
Nextcloud 34. Die installierte Ausgabe besteht Nextclouds Integritätsprüfung
mit `CN=logcleaner`, ausgestellt von der Nextcloud Code Signing Intermediate
Authority; ihr SHA-256-Zertifikatsfingerabdruck lautet
`FF:2B:76:3C:A4:86:4C:4E:B9:B9:3F:15:8D:22:10:BE:C9:BA:EA:5E:C6:EE:BF:11:EB:4C:9E:1C:8A:FC:F9:04`.
Ein Rücksetzen auf 1.5.8 wäre damit ein unbegründeter Sicherheitsrückschritt;
1.5.9 bleibt aktiv.

Während des vom Updater gesetzten Wartungsmodus protokollierten bestehende
Clients neun DAV-Ausnahmen „System befindet sich im Wartungsmodus“ und drei
Hinweise auf die in dieser Phase noch nicht geladene Route
`logcleaner.page.index`. Nach Ende des Wartungsmodus liefen 17 weitere
`/index.php/204`-Anfragen von 01:24 bis 02:51 Uhr ohne erneuten Routenhinweis; auch
`router:match` löst die Route nun korrekt auf. Eine spätere einzelne
PHP-Fehlermeldung um 00:08 UTC stammt nachweislich von einem fehlerhaften
manuellen, rein lesenden Prüfaufruf dieser Sitzung und nicht von einer App.
Alle danach frisch abgegrenzten Produktprüfungen blieben fehlerfrei.

## Noch ausstehender sichtbarer Normalbrowser-Beleg

Der normale Chrome befindet sich unverändert auf
`Geplante Aufgaben - Google Chrome`. Zwei Versuche hinter dem aktiven
Cinnamon-Sperrbildschirm brachen korrekt vor einem belegten eigenen Tab ab;
es wurde weder navigiert noch ein Tab geschlossen. Zwei beim ersten
Fehlversuch entstandene private Fehlaufnahmen wurden entfernt und werden nicht
als Produktbeleg gewertet.

Der technische und isolierte Browserbefund ist vollständig grün. Der einzige
noch offene Abnahmepunkt ist ein beschnittener Seitenbeleg im vorhandenen
normalen Chrome. Er darf erst im ersten entsperrten Abwesenheitsfenster unter
dem gemeinsamen GUI-Guard entstehen: eigener Tab muss vorab unabhängig
belegt sein, die Ziel-URL muss im Produktlog HTTP 200 sowie genau einen
Auswahl- und einen Bildabruf zeigen, danach wird nur dieser Tab geschlossen
und der ursprüngliche Chrome-Titel verifiziert.
