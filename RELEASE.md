# BackgroundChanger release

App-ID und Archivwurzel: `backgroundchanger`; Produktname: `BackgroundChanger`.
Ein unveränderlicher Tag `vX.Y.Z` und ein finales signiertes Archiv werden für
Installation, GitHub und Nextcloud App Store verwendet. Keine echten Schlüssel
ins Repository kopieren. Beispiele verwenden ausschließlich Platzhalter.

## 1. Prüfen, committen, taggen und bauen

Voraussetzungen: Git, Python 3.9+ und die Werkzeuge für `tests/check.sh`.
Release-Regressionstests benötigen außerdem PHP CLI und Python `cryptography`
(43+ für die UTC-Zertifikatsattribute). Der Builder selbst benötigt nur die
Python-Standardbibliothek, führt jedoch verpflichtend das getrackte
`tests/check.sh` aus. Es gibt keinen Skip-Schalter; Fehler verhindern das Paket.

```sh
cd /path/to/backgroundchanger
git fetch origin
bash tests/check.sh
python3 tests/release-test.py
```

Zusätzlich die vorhandenen Nextcloud-/Browser-Integrationstests gegen eine
unterstützte Testinstallation ausführen. Version, Changelog, Identität, Lizenz
und Änderungen prüfen, gezielt committen; bei Änderungen Tests wiederholen.
Kein pauschales `git add .`. Remote-Änderungen regulär zusammenführen.

Beispiel für 1.0.4; für spätere Releases alle Versionsangaben anpassen:

```sh
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git status --short
# Erst bei sauberem Arbeitsbaum und erfolgreichen Tests:
git tag -a v1.0.4 -m 'BackgroundChanger 1.0.4'
mkdir -p build
python3 tests/release.py build --tag v1.0.4 \
  --output build/backgroundchanger-1.0.4-unsigned.tar.gz
sha256sum build/backgroundchanger-1.0.4-unsigned.tar.gz
tar -tzf build/backgroundchanger-1.0.4-unsigned.tar.gz
```

`origin/main` muss vorher durch `git fetch origin` aktualisiert werden; der
Builder führt kein Fetch, Commit, Tag oder Push aus. Er verlangt HEAD == Tag,
passende ID/Name/Version, `origin/main` als Vorfahren und einen sauberen
Arbeitsbaum inklusive Index. Untracked Dateien sowie ignorierte Runtime-Zusätze
werden abgelehnt. Ignorierte Build-/Vendor-Inhalte werden nicht eingelesen.
Ausgabe ist außerhalb des Repos oder unter dessen ignoriertem `build/` erlaubt,
niemals in Runtime-/sonstigen Repo-Pfaden. Bestehende Ausgaben werden nicht ersetzt.
Das Ausgabeverzeichnis vorher anlegen.

Payload kommt aus unveränderlichen Git-Blobs. Allowlist: `appinfo` (.xml/.php),
`css` (.css), `img` (Bildformate), `js` (.js), `lib` (.php), README/CHANGELOG/LICENSE
(mit oder ohne .md). Test-/Build-/Key-/Vendor-/versteckte Pfade, Signaturen und
verdächtige Geheimnisnamen werden ausgeschlossen. Runtime-Symlinks und PEM-
Private-Key-Marker werden abgelehnt. Sonstige Geheimnisse müssen vor dem Commit
inhaltlich ausgeschlossen werden. Sortierung und Metadaten sind normalisiert;
derselbe Commit liefert mit derselben Python/zlib-Version bytegleiche Archive.

## 2. Unverändertes Archiv mit externem Schlüssel signieren

Auf dem vorhandenen sicheren Signierrechner das Quellrepo auf denselben sauberen
Tag synchronisieren und dieselbe geprüfte Version von `tests/release.py` verwenden.
Nur Quellrepo und unsigned Archiv dorthin übertragen,
niemals den privaten Schlüssel zum Build-Rechner. SHA256 nach der Übertragung
mit dem oben festgehaltenen Wert vergleichen. Der Key und das Zertifikat müssen
außerhalb des Quellrepos liegen; keine Shell-Traces, Schlüssel oder Passphrasen
loggen. `sign` ist der einzige Produktionspfad, der einen privaten Key liest.

```sh
cd /path/to/backgroundchanger
python3 -c 'import cryptography; print(cryptography.__version__)'
sha256sum build/backgroundchanger-1.0.4-unsigned.tar.gz
python3 tests/release.py sign \
  --repo . \
  --unsigned build/backgroundchanger-1.0.4-unsigned.tar.gz \
  --tag v1.0.4 \
  --key /secure/external/path/backgroundchanger.key \
  --certificate /secure/external/path/backgroundchanger.crt \
  --output build/backgroundchanger-1.0.4.tar.gz
sha256sum build/backgroundchanger-1.0.4-unsigned.tar.gz \
  build/backgroundchanger-1.0.4.tar.gz
tar -tzf build/backgroundchanger-1.0.4.tar.gz
```

Der Signierer verlangt einen unverschlüsselten PEM-RSA-Key, ein aktuell gültiges
passendes PEM-Zertifikat mit genau CN `backgroundchanger`, ID/Name/Version passend
zum angegebenen Tag und ein reines unsigned Runtime-Archiv. Fremde/unsichere
Pfade, Links, doppelte Member und vorhandene Signaturen werden abgelehnt; das
Archiv wird nie ins Dateisystem entpackt. Die Quelle bleibt unverändert, alle
Runtime-Dateibytes werden unverändert übernommen. Nur `appinfo/signature.json`
wird ergänzt: sortierte SHA512-Dateihashes und RSA-PSS mit SHA1, MGF1(SHA512),
Saltlänge 0 über PHP-`json_encode`-kompatible Hash-Daten. Die erzeugte Signatur
wird vor Ausgabe kryptographisch verifiziert. Synthetische Tests prüfen sie
zusätzlich über unabhängig mit PHP serialisierte Daten.

Vor dem Lesen des Schlüssels prüft `sign` den sauberen Quellstand, HEAD == Tag
und die vollständige Runtime-Dateiliste samt Bytes gegen die unveränderlichen
Git-Blobs dieses Tags. Manipulierte oder fremde Runtime-Inhalte werden abgelehnt.
`--repo` ist optional und entspricht wie bei `build` standardmäßig dem Quellrepo
des Werkzeugs. Es erfolgt kein erneuter Build/Test auf dem Signierrechner.
Zusätzlich SHA256 aus dem vertrauenswürdigen Build nach der Übertragung vergleichen. Die lokale Zertifikatsprüfung ersetzt
keine Nextcloud-Vertrauenskette. Das finale Archiv muss auf der Zielinstallation
Nextclouds echte Code-Integritätsprüfung bestehen, bevor veröffentlicht wird.

## 3. Dasselbe finale Archiv installieren und veröffentlichen

Bestehende Installation und Rückweg sichern, genau das finale Archiv installieren.
Zielinstallation zurücklesen: App-ID, Version und Code-Integrität ohne Fehler;
Quellenanzeige/Attribution und Einstellungen real prüfen. Den konkreten
Installationspfad, Webserverbenutzer und vorhandenen Betriebsablauf lokal verwenden,
nicht private Betriebsdetails in diese öffentliche Anleitung eintragen.

Erst nach erfolgreicher Zielprüfung regulär veröffentlichen (GitHub CLI benötigt
vorhandene Anmeldung und das passende Repository-Remote):

```sh
git push origin main
git push origin v1.0.4
gh release create v1.0.4 build/backgroundchanger-1.0.4.tar.gz \
  --verify-tag --title 'BackgroundChanger 1.0.4' --notes-file CHANGELOG.md
git ls-remote origin refs/tags/v1.0.4 'refs/tags/v1.0.4^{}'
verify_dir=$(mktemp -d)
gh release download v1.0.4 --pattern backgroundchanger-1.0.4.tar.gz --dir "$verify_dir"
cmp build/backgroundchanger-1.0.4.tar.gz "$verify_dir/backgroundchanger-1.0.4.tar.gz"
rm "$verify_dir/backgroundchanger-1.0.4.tar.gz"
rmdir "$verify_dir"
```

Bei abgelehntem Push oder vorhandenen Releases anhalten, nichts force-pushen,
keine Tags verschieben und keine Assets still ersetzen. Korrekturen bekommen
eine neue Version. Im Nextcloud App Store dieselbe unveränderliche GitHub-Asset-
URL und die vom Store geforderte separate Archivsignatur über den vorhandenen
Store-Veröffentlichungsablauf einreichen. Diese ist **nicht** die interne
`appinfo/signature.json`; `release.py sign` erzeugt nur letztere. Store-Eintrag
zurücklesen (App-ID, Version, URL), Download erneut mit dem finalen Archiv
vergleichen. Erst dann ist die Veröffentlichung abgeschlossen.

Temporäre unsigned/testweise erzeugte Dateien erst nach Abnahme entfernen;
finales Artefakt und notwendige Rückwege erhalten. Keine neue Infrastruktur.