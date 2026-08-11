import { describe, expect, it } from "vitest";
import { validarCelular } from "../utils/phoneValidation";

describe("phoneValidation", () => {
  it("acepta un celular argentino válido (con el 9)", () => {
    const result = validarCelular("+5491123456789", "AR");
    expect(result).toEqual({ valido: true, esCelular: true, e164: "+5491123456789" });
  });

  it("rechaza un número argentino sin el 9 (se clasifica como línea fija)", () => {
    const result = validarCelular("+541123456789", "AR");
    expect(result.valido).toBe(false);
    expect(result.e164).toBeNull();
  });

  it("acepta un celular brasileño válido (con el 9, DDD 11)", () => {
    const result = validarCelular("+5511961234567", "BR");
    expect(result).toEqual({ valido: true, esCelular: true, e164: "+5511961234567" });
  });

  it("rechaza un número brasileño sin el 9 (formato inválido)", () => {
    const result = validarCelular("+551161234567", "BR");
    expect(result.valido).toBe(false);
  });

  it("acepta un celular mexicano válido (formato post-2019, sin el 1)", () => {
    const result = validarCelular("+525512345678", "MX");
    expect(result.valido).toBe(true);
    expect(result.e164).toBe("+525512345678");
  });

  it("rechaza explícitamente una línea fija (Uruguay)", () => {
    const result = validarCelular("+59821234567", "UY");
    expect(result.valido).toBe(false);
    expect(result.esCelular).toBe(false);
    expect(result.e164).toBeNull();
  });

  it("rechaza un número inválido", () => {
    const result = validarCelular("123", "AR");
    expect(result).toEqual({ valido: false, esCelular: false, e164: null });
  });
});
