import { useDispatch, useSelector } from "react-redux";
import { setEsims, updateEsim } from "./actions";

export const useEsims = () => {
  const dispatch = useDispatch();
  const esims = useSelector((state) => {
    return state.esim.esims;
  });

  return {
    esims: esims,
    updateEsim: (request, esim) => dispatch(updateEsim(request, esim)),
    setEsims: (esim) => dispatch(setEsims(esim)),
  };
};
