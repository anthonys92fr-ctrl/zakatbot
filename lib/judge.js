// LLM-as-judge : évalue les trois réponses (LLM seul, RAG, RAG + Graph RAG) sur une même question.
import { complete } from "./llm.js";

const MODE_INFO = {
  llm: { letter: "A", label: "modèle seul (sans documents)" },
  rag: { letter: "B", label: "LLM + RAG (modèle + passages)" },
  graph: { letter: "C", label: "LLM + RAG + Graph RAG (modèle + passages + graphe d'entités)" },
};

function judgePrompt(present) {
  const list = present.map((m) => `${MODE_INFO[m].letter} = ${MODE_INFO[m].label}`).join(", ");
  const letters = present.map((m) => MODE_INFO[m].letter);
  const scoresShape = letters.map((L) => `"${L}":{"exactitude":0,"fidelite":0,"completude":0,"clarte":0}`).join(",");
  const analysesShape = letters.map((L) => `"${L}":"..."`).join(",");
  const several = present.length > 1;
  return `Tu es un évaluateur impartial et exigeant de réponses de chatbots.
On te donne une QUESTION, le CONTEXTE DOCUMENTAIRE de référence (passages et graphe récupérés), et ${several ? `${present.length} réponses` : "UNE réponse"} : ${list}.

Note chaque réponse de 0 à 10 sur quatre critères :
- exactitude : les faits sont-ils corrects au regard du contexte de référence (ou du savoir général si le contexte ne couvre pas) ?
- fidelite : la réponse s'appuie-t-elle sur les sources sans inventer (hallucinations pénalisées fortement) ?
- completude : couvre-t-elle tous les éléments attendus par la question ?
- clarte : est-elle bien structurée, concise, lisible ?

Puis explique en 2 à 4 phrases, pour chaque réponse, CE QUI S'EST PASSÉ : d'où viennent les bonnes informations, quelles erreurs ou omissions, et quel rôle les documents / le graphe ont joué (ou auraient dû jouer).
${several ? "Termine par un verdict global : quelle approche a le mieux répondu et pourquoi, en une phrase ou deux." : "Termine par un verdict global sur la qualité de cette réponse, en une phrase ou deux."}

Réponds UNIQUEMENT en JSON valide :
{"scores":{${scoresShape}},
 "analyses":{${analysesShape}},
 "verdict":"...", "gagnant":"${letters.join("|")}${several ? "|égalité" : ""}"}`;
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function judge({ question, answers, context, effort = "medium" }) {
  const present = ["llm", "rag", "graph"].filter((m) => typeof answers?.[m] === "string" && answers[m].trim());
  if (present.length === 0) throw new Error("Aucune réponse à juger");
  const user = [
    `QUESTION :\n${question}`,
    `CONTEXTE DOCUMENTAIRE DE RÉFÉRENCE :\n${context || "(aucun document indexé)"}`,
    ...present.map((m) => `RÉPONSE ${MODE_INFO[m].letter} (${MODE_INFO[m].label}) :\n${answers[m]}`),
  ].join("\n\n---\n\n");

  const { text, usage } = await complete(
    [{ role: "system", content: judgePrompt(present) }, { role: "user", content: user }],
    { effort, maxTokens: 2500 },
  );
  const data = parseJson(text);
  if (!data?.scores) throw new Error("Réponse du juge illisible");
  data.modes = present;
  data.analyses = Object.fromEntries(Object.entries(data.analyses || {}).map(([k, v]) => [k, String(v ?? "").slice(0, 4000)]));
  data.verdict = String(data.verdict ?? "").slice(0, 2000);
  data.gagnant = typeof data.gagnant === "string" ? data.gagnant.slice(0, 10) : "";
  for (const k of present.map((m) => MODE_INFO[m].letter)) {
    const raw = data.scores[k] || {};
    const num = (v) => Math.max(0, Math.min(10, Number(v) || 0));
    const s = { exactitude: num(raw.exactitude), fidelite: num(raw.fidelite), completude: num(raw.completude), clarte: num(raw.clarte) };
    s.total = Math.round((s.exactitude + s.fidelite + s.completude + s.clarte) / 4 * 10) / 10;
    data.scores[k] = s;
  }
  return { ...data, usage };
}
