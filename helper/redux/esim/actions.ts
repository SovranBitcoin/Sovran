import { SET_ESIM, UPDATE_ESIM } from './actionTypes';
import { Esim, EsimOrder } from './types';

export type EsimAction = ReturnType<typeof setEsims> | ReturnType<typeof updateEsim>;

export const setEsims = (esim: Esim) =>
  ({
    type: SET_ESIM,
    payload: esim,
  }) as const;

export const updateEsim = (request: string, payload: EsimOrder) =>
  ({
    type: UPDATE_ESIM,
    payload: { request, ...payload },
  }) as const;
