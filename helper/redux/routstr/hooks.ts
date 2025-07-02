import { useDispatch, useSelector } from 'react-redux';
import {
  setRoutstrToken,
  addRoutstrSession,
  addRoutstrMessage,
  setCurrentSession,
  setRoutstrBalance,
  setLastToken,
} from './actions';
import {
  memoizedGetRoutstrToken,
  memoizedGetCurrentSession,
  memoizedGetSessions,
  memoizedGetRoutstrBalance,
  memoizedGetLastToken,
} from './selectors';

export const useRoutstr = () => {
  const dispatch = useDispatch();
  const token = useSelector(memoizedGetRoutstrToken);
  const balance = useSelector(memoizedGetRoutstrBalance);
  const currentSession = useSelector(memoizedGetCurrentSession);
  const sessions = useSelector(memoizedGetSessions);
  const lastToken = useSelector(memoizedGetLastToken);

  return {
    token,
    balance,
    currentSession,
    sessions,
    lastToken,
    setToken: (t: string) => dispatch(setRoutstrToken(t)),
    setBalance: (b: number) => dispatch(setRoutstrBalance(b)),
    createSession: (id: string) => dispatch(addRoutstrSession(id)),
    addMessage: (id: string, msg: { role: string; content: string }) =>
      dispatch(addRoutstrMessage(id, msg)),
    setCurrentSession: (id: string) => dispatch(setCurrentSession(id)),
    setLastToken: (t: string) => dispatch(setLastToken(t)),
  };
};
