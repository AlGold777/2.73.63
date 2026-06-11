const fs = require('fs');
const path = require('path');

describe('release log regression guards', () => {
  test('transport decision is emitted even when API fallback is disabled', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

    expect(source).toContain('const apiUsed = await tryApiDirect(llmName, prompt, attachments);');
    expect(source).not.toContain('if (jobState.useApiFallback !== false) {\n      apiUsed = await tryApiDirect');
    expect(source).toContain("details: `${transportDecision.mode}:${transportDecision.reason}`");
    expect(source).toContain('dispatchReason: \'start_model\'');
  });

  test('round exports do not infer R4 completion from MODEL_FINAL', () => {
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

    expect(resultsSource).not.toContain("normalizedLabel === 'MODEL_FINAL' || normalizedLabel === 'FINAL_STATUS'");
    expect(devtoolsSource).not.toContain("normalizedLabel === 'MODEL_FINAL' || normalizedLabel === 'FINAL_STATUS'");
  });

  test('debate pause is a soft pause instead of a stop/cancel action', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');

    expect(html).toContain('id="debate-run-toggle-btn"');
    expect(html).toContain('aria-label="Run debate"');
    expect(html).toContain('id="debate-run-policy-select"');
    expect(html).toContain('<option value="manual" selected="">Manual</option>');
    expect(html).toContain('id="auto-checkbox"');
    expect(html).toContain('hidden="" aria-hidden="true"');
    expect(html).not.toContain('id="debate-start-btn"');
    expect(html).not.toContain('id="debate-pause-btn"');
    expect(source).toContain('const debateRunToggleBtn = document.getElementById(\'debate-run-toggle-btn\');');
    expect(source).toContain('const debateRunPolicySelect = document.getElementById(\'debate-run-policy-select\');');
    expect(source).toContain("const isDebateAutoPolicy = () => getDebateRunPolicy() === 'auto';");
    expect(source).toContain("debateRunToggleBtn.textContent = 'Ⅱ';");
    expect(source).toContain("debateRunToggleBtn.setAttribute('aria-label', 'Pause after current turn');");
    expect(source).toContain('const debateMaxTurnsInput = document.getElementById(\'debate-max-turns-input\');');
    expect(source).toContain("setDebatePausedState(true, 'pause_button');");
    expect(source).toContain("setDebatePausedState(false, 'resume_button');");
    expect(source).toContain('Debate paused after ${debateRunState.maxTurns} auto turns.');
    expect(source).not.toContain("debatePauseBtn?.addEventListener('click', async () => {\n            if (pipelineRunActive) {\n                await cancelPipelineRun();");
  });

  test('debate engine foundation is loaded and routed through background executor', () => {
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const backgroundIndex = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');
    const routerSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(pipelineHtml).toContain('<script src="shared/debate-engine.js"></script>');
    expect(resultHtml).toContain('<script src="shared/debate-engine.js"></script>');
    expect(backgroundIndex).toContain("'../shared/debate-engine.js'");
    expect(backgroundIndex).toContain("'debate-executor.js'");
    expect(routerSource).toContain('self.DebateBackgroundExecutor?.canHandle?.(message)');
    expect(routerSource).toContain('self.DebateBackgroundExecutor.handleMessage(message, sender)');
    expect(resultsSource).toContain('const DebateEngineRuntime = window.DebateEngine || null;');
    expect(resultsSource).toContain('function collectDebateArtifact()');
    expect(resultsSource).toContain("type: 'START_DEBATE_RUN'");
    expect(resultsSource).toContain("type: debatePaused ? 'PAUSE_DEBATE' : 'RESUME_DEBATE'");
    expect(resultsSource).toContain("type: 'CANCEL_DEBATE'");
  });
});
