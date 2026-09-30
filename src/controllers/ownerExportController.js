import * as exportService from "../services/exportService.js";

/**
 * GET /api/owner/exports/xlsx
 * Generates and downloads a multi-sheet XLSX report for the specified business date range.
 *
 * Query parameters:
 *   from=YYYY-MM-DD
 *   to=YYYY-MM-DD
 */
export async function downloadOperationalXlsx(req, res, next) {
  try {
    const { buffer, filename } = await exportService.generateOperationalXlsx(req.query);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    return res.status(200).send(buffer);
  } catch (error) {
    next(error);
  }
}
