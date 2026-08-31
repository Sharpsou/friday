import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadFrozenCorpus, privateCorpusRoot } from './corpus.js';
import {
  blindLabel,
  CANDIDATE_MODEL_PAIRS,
  type EvaluationResult,
} from './runner.js';

interface StoredCampaign {
  results: Array<EvaluationResult | { error: string }>;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
}

function weightedUnitRate(
  values: EvaluationResult[],
  key: 'supportedUnitRate' | 'contradictedUnitRate',
): number {
  const units = values.reduce(
    (sum, { metrics }) => sum + metrics.factualUnitCount,
    0,
  );
  return units === 0
    ? 0
    : values.reduce(
        (sum, { metrics }) => sum + metrics[key] * metrics.factualUnitCount,
        0,
      ) / units;
}

function summarizePair(pairId: string, values: EvaluationResult[]) {
  return {
    pairId,
    attempts: values.length,
    passRate: mean(values.map(({ decision }) => (decision === 'pass' ? 1 : 0))),
    supportedUnitRate: weightedUnitRate(values, 'supportedUnitRate'),
    contradictedUnitRate: weightedUnitRate(values, 'contradictedUnitRate'),
    citationPrecision: mean(
      values.map(({ metrics }) => metrics.citationPrecision),
    ),
    citationCompleteness: mean(
      values.map(({ metrics }) => metrics.citationCompleteness),
    ),
    revisionRate: mean(
      values.map(({ revisionUsed }) => (revisionUsed ? 1 : 0)),
    ),
    auditFallbackRate: mean(
      values.map(({ auditFallbacks }) => (auditFallbacks > 0 ? 1 : 0)),
    ),
    averageElapsedMs: mean(values.map(({ elapsedMs }) => elapsedMs)),
    p95ElapsedMs: percentile95(values.map(({ elapsedMs }) => elapsedMs)),
    lexicalFallbackRate: mean(
      values.map(({ retrievalMode }) =>
        retrievalMode === 'lexical_fallback' ? 1 : 0,
      ),
    ),
    referenceParagraphRecall: mean(
      values.flatMap(({ referenceParagraphRecall }) =>
        referenceParagraphRecall === null ? [] : [referenceParagraphRecall],
      ),
    ),
    retrievalDimensionCoverage: mean(
      values.flatMap(({ retrievalDimensionCoverage }) =>
        retrievalDimensionCoverage === null ? [] : [retrievalDimensionCoverage],
      ),
    ),
  };
}

function htmlDocument(payload: unknown): string {
  const safeJson = JSON.stringify(payload).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Friday — revue A/B aveugle</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1200px;margin:auto;padding:24px;background:#f6f7f9;color:#17202a}header{position:sticky;top:0;background:#f6f7f9;padding:8px 0;z-index:2}.item{background:white;border:1px solid #d9dee5;border-radius:12px;padding:18px;margin:18px 0}.answers{display:grid;grid-template-columns:1fr 1fr;gap:16px}.answer{border:1px solid #d9dee5;border-radius:8px;padding:12px;white-space:pre-wrap}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}label{display:inline-flex;gap:5px;align-items:center}textarea{width:100%;min-height:60px;margin-top:10px}button{padding:9px 14px}@media(max-width:800px){.answers{grid-template-columns:1fr}}
</style></head><body><header><h1>Revue humaine A/B aveugle</h1><p id="progress"></p><button id="export">Exporter les décisions JSON</button></header><main id="items"></main>
<script>const items=${safeJson};const state={};const root=document.querySelector('#items');
function update(){const done=Object.values(state).filter(x=>x.preferred).length;document.querySelector('#progress').textContent=done+' / '+items.length+' comparaisons avec préférence';}
for(const item of items){const section=document.createElement('section');section.className='item';const h=document.createElement('h2');h.textContent=item.caseId+' — graine '+item.seed;section.append(h);const q=document.createElement('p');q.textContent=item.question;section.append(q);const criteria=document.createElement('p');criteria.textContent='Critères : '+item.criteria.expectedAspects.join(' · ');section.append(criteria);const answers=document.createElement('div');answers.className='answers';for(const candidate of item.candidates){const box=document.createElement('div');const title=document.createElement('h3');title.textContent=candidate.label;const text=document.createElement('div');text.className='answer';text.textContent=candidate.answer;box.append(title,text);answers.append(box);}section.append(answers);const key=item.caseId+'|'+item.seed;state[key]={caseId:item.caseId,seed:item.seed,preferred:null,a:{usefulness:null,writingQuality:null,importantContradiction:false,catastrophicFailure:false},b:{usefulness:null,writingQuality:null,importantContradiction:false,catastrophicFailure:false},notes:''};const controls=document.createElement('div');controls.className='controls';for(const value of ['A','B','égalité']){const label=document.createElement('label');const radio=document.createElement('input');radio.type='radio';radio.name='preferred-'+key;radio.value=value;radio.onchange=()=>{state[key].preferred=value;update()};label.append(radio,document.createTextNode(value));controls.append(label);}section.append(controls);for(const labelName of ['A','B']){const row=document.createElement('div');row.className='controls';const title=document.createElement('strong');title.textContent=labelName;row.append(title);for(const metric of ['usefulness','writingQuality']){const label=document.createElement('label');label.textContent=metric+' ';const select=document.createElement('select');const empty=document.createElement('option');empty.value='';empty.textContent='—';select.append(empty);for(let n=1;n<=5;n++){const option=document.createElement('option');option.value=String(n);option.textContent=String(n);select.append(option)}select.onchange=()=>{state[key][labelName.toLowerCase()][metric]=select.value?Number(select.value):null};label.append(select);row.append(label)}for(const metric of ['importantContradiction','catastrophicFailure']){const label=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.onchange=()=>{state[key][labelName.toLowerCase()][metric]=checkbox.checked};label.append(checkbox,document.createTextNode(metric));row.append(label)}section.append(row)}const notes=document.createElement('textarea');notes.placeholder='Notes humaines';notes.oninput=()=>{state[key].notes=notes.value};section.append(notes);root.append(section)}update();document.querySelector('#export').onclick=()=>{const blob=new Blob([JSON.stringify({reviewedAt:new Date().toISOString(),reviews:Object.values(state)},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='human-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)};</script></body></html>`;
}

export async function buildReviewArtifacts(
  root: string,
  runId: string,
): Promise<{ reviewPath: string; reportPath: string; pairs: number }> {
  const safeRoot = privateCorpusRoot(root);
  const campaign = JSON.parse(
    await readFile(join(safeRoot, 'results', runId, 'results.json'), 'utf8'),
  ) as StoredCampaign;
  const corpus = await loadFrozenCorpus(safeRoot);
  const successes = campaign.results.filter(
    (result): result is EvaluationResult => 'answer' in result,
  );
  const pairIds = CANDIDATE_MODEL_PAIRS.map(({ id }) => id);
  const reviewItems = corpus.cases.flatMap((evalCase) =>
    [17, 29, 43].flatMap((seed) => {
      const candidates = successes.filter(
        (result) => result.caseId === evalCase.id && result.seed === seed,
      );
      if (candidates.length !== 2) return [];
      return [
        {
          caseId: evalCase.id,
          seed,
          question: evalCase.question,
          criteria: evalCase.criteria,
          candidates: candidates
            .map((result) => ({
              label: blindLabel(
                result.caseId,
                result.seed,
                result.pairId,
                pairIds,
              ),
              answer: result.answer,
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        },
      ];
    }),
  );
  const summaries = CANDIDATE_MODEL_PAIRS.map(({ id }) => {
    const values = successes.filter(({ pairId }) => pairId === id);
    return summarizePair(id, values);
  });
  const splitSummaries = Object.fromEntries(
    (['development', 'validation'] as const).map((split) => [
      split,
      CANDIDATE_MODEL_PAIRS.map(({ id }) =>
        summarizePair(
          id,
          successes.filter(
            (result) =>
              result.pairId === id &&
              corpus.cases.find(({ id: caseId }) => caseId === result.caseId)
                ?.split === split,
          ),
        ),
      ),
    ]),
  );
  const reviewPath = join(safeRoot, 'reviews', runId, 'blind-review.html');
  const reportPath = join(safeRoot, 'results', runId, 'campaign-report.json');
  await writeFile(reviewPath, htmlDocument(reviewItems), 'utf8');
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        runId,
        expectedAttempts: 120,
        successfulAttempts: successes.length,
        failures: campaign.results.length - successes.length,
        blindReviewPairs: reviewItems.length,
        summaries,
        splitSummaries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { reviewPath, reportPath, pairs: reviewItems.length };
}
