#!/usr/bin/env bash
# Télécharge les PDF de référence sur la zakat dans docs/pdf/ (non versionnés : droits de leurs éditeurs).
# Usage : bash deploy/fetch-pdfs.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/pdf
get() { # url nom
  local url="$1" name="docs/pdf/$2"
  if [ -s "$name" ]; then echo "déjà présent : $2"; return; fi
  echo "téléchargement : $2"
  curl -sL -A "Mozilla/5.0" --max-time 180 -o "$name" "$url" || { echo "  échec : $url"; rm -f "$name"; return; }
  if [ "$(head -c 5 "$name")" != "%PDF-" ]; then echo "  pas un PDF, ignoré : $url"; rm -f "$name"; fi
}
get "https://www.islamicstudies.info/literature/fiqhalzakah_vol1.pdf" qaradawi-fiqh-al-zakah-vol1.pdf
get "https://www.islamicstudies.info/literature/fiqhalzakah_vol2.pdf" qaradawi-fiqh-al-zakah-vol2.pdf
get "https://nzf.org.uk/wp-content/uploads/2025/02/2025_NZF_General-Zakat-Guide.pdf" nzf-general-zakat-guide-2025.pdf
get "https://nzf.org.uk/wp-content/uploads/2025/02/2025_NZF_Business-Zakat-Guide.pdf" nzf-business-zakat-guide-2025.pdf
get "https://nzf.org.uk/wp-content/uploads/2021/03/NZF_Calculating-missed-Zakat_A5_P_2021_V1.1.pdf" nzf-missed-zakat-guide-2021.pdf
get "https://zatca.gov.sa/en/MediaCenter/Publications/Documents/Summary%20Fiqh%20of%20Zakat%20Estimation%20Book-En.pdf" zatca-summary-fiqh-zakat-estimation.pdf
get "https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Zakat-General-Guideline-Zakat-Collection-1445AH.pdf" zatca-zakat-general-guideline-1445.pdf
get "https://newmuslims.com/fr/lesson/pdf/164" newmuslims-zakat-fr-lecon-164.pdf
get "https://newmuslims.com/fr/lesson/pdf/165" newmuslims-zakat-fr-lecon-165.pdf
echo "Terminé. Lance ensuite : npm run index"
