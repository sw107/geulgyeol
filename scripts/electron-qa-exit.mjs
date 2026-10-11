// Observe only the child process owned by this QA invocation. No process scan.
export function waitForOwnedQAExit(child, timeoutMs) {
  const result = confirmed => ({exitConfirmed:confirmed, exitCode:child.exitCode,
    signalCode:child.signalCode, terminationUnconfirmed:!confirmed});
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(result(true));
  return new Promise(resolve => {
    let timer;
    const done = confirmed => {clearTimeout(timer);child.removeListener('exit',onExit);resolve(result(confirmed));};
    const onExit = () => done(true);
    child.once('exit',onExit);
    timer = setTimeout(() => done(false),timeoutMs);
    // Covers a child that exited between the first inspection and subscription.
    if (child.exitCode !== null || child.signalCode !== null) done(true);
  });
}

export async function finishOwnedQA(child, {requestClose, allowTerminate=false,
  closeTimeoutMs=5000, terminationTimeoutMs=5000} = {}) {
  if (child.exitCode === null && child.signalCode === null) await requestClose();
  let exit = await waitForOwnedQAExit(child,closeTimeoutMs), terminationRequested=false;
  if (!exit.exitConfirmed && allowTerminate) {
    terminationRequested=child.kill('SIGTERM');
    // Sending SIGTERM is not confirmation of exit. Keep waiting for this child.
    exit=await waitForOwnedQAExit(child,terminationTimeoutMs);
  }
  return {...exit,terminationRequested,normalQuit:exit.exitConfirmed
    && exit.exitCode===0 && exit.signalCode===null && !terminationRequested};
}
