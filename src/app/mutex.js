// 키(세션 id)별 비동기 뮤텍스: 같은 키의 작업은 도착 순서대로 한 번에 하나씩 실행한다.
// ponytail: 단일 프로세스 한정. 다중 인스턴스·Workers에서는 DO(세션당 단일 작성자)가 이 역할을 대신한다.
export function createKeyedMutex() {
  const tails = new Map();
  return {
    async run(key, fn) {
      const prev = tails.get(key) || Promise.resolve();
      let release;
      const gate = new Promise((r) => { release = r; });
      const tail = prev.then(() => gate);
      tails.set(key, tail);
      await prev;
      try { return await fn(); } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}
