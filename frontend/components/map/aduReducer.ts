import type { AduState, AduAction } from './types';
import {
  DEFAULT_LEG_DIMENSIONS,
  DEFAULT_ADU_SIZE_SQFT,
  DEFAULT_ADU_ASPECT_RATIO,
} from './constants';

export const ADU_INITIAL_STATE: AduState = {
  center: null,
  size: DEFAULT_ADU_SIZE_SQFT,
  aspectRatio: DEFAULT_ADU_ASPECT_RATIO,
  rotation: 0,
  type: 'detached',
  isValid: true,
  isAttachedSnapPending: false,
  isAutoCorrecting: false,
  legDimensions: {
    'l-shape': { ...DEFAULT_LEG_DIMENSIONS['l-shape'] },
    't-shape': { ...DEFAULT_LEG_DIMENSIONS['t-shape'] },
    'u-shape': { ...DEFAULT_LEG_DIMENSIONS['u-shape'] },
  },
};

export function aduReducer(state: AduState, action: AduAction): AduState {
  switch (action.type) {
    case 'SET_CENTER':
      return { ...state, center: action.center };
    case 'SET_SIZE':
      return { ...state, size: action.size };
    case 'SET_ASPECT_RATIO':
      return { ...state, aspectRatio: action.aspectRatio };
    case 'SET_ROTATION':
      return { ...state, rotation: action.rotation };
    case 'SET_TYPE':
      return { ...state, type: action.aduType };
    case 'SET_IS_VALID':
      return { ...state, isValid: action.isValid };
    case 'SET_ATTACHED_SNAP_PENDING':
      return { ...state, isAttachedSnapPending: action.pending };
    case 'SET_AUTO_CORRECTING':
      return { ...state, isAutoCorrecting: action.correcting };
    case 'SET_LEG_DIMENSIONS': {
      return {
        ...state,
        legDimensions: {
          ...state.legDimensions,
          [action.shape]: { ...action.dims },
        },
      };
    }
    case 'BATCH':
      return action.actions.reduce(aduReducer, state);
    case 'RESET':
      return ADU_INITIAL_STATE;
    default:
      return state;
  }
}
