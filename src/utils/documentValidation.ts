/**
 * Nombre/sigla del documento de identidad por país (ISO 3166-1 alpha-2), para los 19 países de LATAM.
 */
export const DOCUMENTO_POR_PAIS: Record<string, string> = {
  AR: "DNI",
  BO: "CI",
  BR: "CPF",
  CL: "RUN",
  CO: "CC",
  CR: "Cédula",
  CU: "CI",
  EC: "Cédula",
  SV: "DUI",
  GT: "DPI",
  HN: "Tarjeta de Identidad",
  MX: "CURP",
  NI: "Cédula",
  PA: "Cédula",
  PY: "CI",
  PE: "DNI",
  DO: "Cédula",
  UY: "CI",
  VE: "CI",
};

const GENERIC_DOCUMENT_REGEX = /^[A-Za-z0-9]{5,15}$/;

export interface ValidarDocumentoResult {
  valido: boolean;
  label: string;
}

/**
 * Valida un documento de identidad de forma genérica (5 a 15 caracteres alfanuméricos),
 * sin checksum ni formato específico por país — no hay padrón oficial con el que verificar
 * existencia real, así que un formato más estricto no aportaría valor.
 * @param numero - Número de documento a validar.
 * @param paisIso - Código ISO 3166-1 alpha-2 del país (ej. "AR").
 * @returns Si es válido, y el label del documento correspondiente al país ("Documento" si no está en el mapa).
 */
export function validarDocumento(numero: string, paisIso: string): ValidarDocumentoResult {
  const paisNormalizado = paisIso.trim().toUpperCase();
  return {
    valido: GENERIC_DOCUMENT_REGEX.test(numero),
    label: DOCUMENTO_POR_PAIS[paisNormalizado] ?? "Documento",
  };
}
