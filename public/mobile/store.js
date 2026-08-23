// mobile/store.js - 简单响应式状态管理
const createStore = (initState) => {
  let state = initState;
  const listeners = new Set();

  const getState = () => state;

  const setState = (patch) => {
    state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
    listeners.forEach(fn => fn(state));
  };

  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { getState, setState, subscribe };
};

// 全局 store
window.store = createStore({
  user: null,        // { username, displayName, role, department }
  state: null,       // 后端 full state
  loading: false,
  year: new Date().getFullYear(),
  quarter: null,
  activeTab: 'dashboard',
});
