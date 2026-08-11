import { describe, expect, it } from "vitest";
import { DOCUMENTO_POR_PAIS, validarDocumento } from "../utils/documentValidation";

describe("documentValidation", () => {
  it("tiene los 19 países de LATAM mapeados", () => {
    expect(Object.keys(DOCUMENTO_POR_PAIS)).toHaveLength(19);
  });

  it("acepta un documento alfanumérico de 5 a 15 caracteres para un país conocido", () => {
    const result = validarDocumento("12345678", "AR");
    expect(result).toEqual({ valido: true, label: "DNI" });
  });

  it("rechaza un documento fuera del rango 5-15 o con caracteres no alfanuméricos", () => {
    expect(validarDocumento("1234", "AR").valido).toBe(false);
    expect(validarDocumento("1234-5678", "AR").valido).toBe(false);
  });

  it("usa el label 'Documento' por defecto si el país no está en el mapa", () => {
    const result = validarDocumento("12345678", "US");
    expect(result).toEqual({ valido: true, label: "Documento" });
  });
});
