import { useState } from "react";
import { post } from "../api";
import { useAuth } from "../auth";
import {
  Button, Empty, errText, FileDrop, PageHead, Panel, Pill, useToast,
} from "../components/ui";

interface BatchField {
  value?: string;
  confidence?: number;
  source?: string;
  status?: string;
  issues?: string[];
}

interface BatchItem {
  file: string;
  ok: boolean;
  error?: string;
  id?: number;
  status?: string;
  bank_name?: string;
  cheque_number?: string;
  payee_name?: string;
  amount_figures?: string;
  review_count?: number;
  fields?: Record<string, BatchField>;
  final?: Record<string, string>;
  field_order?: string[];
  field_labels?: Record<string, string>;
  quality?: {
    score?: number;
    acceptable?: boolean;
    issues?: { code?: string; message: string }[];
  };
}

interface BatchResult {
  batch_id: string;
  processed: number;
  failed: number;
  total?: number;
  results: BatchItem[];
}

const MAX = 20;

function FieldResults({ item }: { item: BatchItem }) {
  const fields = item.fields ?? {};
  const finalValues = item.final ?? {};
  const order = item.field_order?.length
    ? item.field_order
    : Object.keys(fields);
  const labels = item.field_labels ?? {};

  return (
    <div className="stack">
      <p className="tiny muted">
        {order.length} fields extracted
        {item.quality?.score !== undefined
          ? ` · Image quality ${item.quality.score}/100`
          : ""}
      </p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Extracted value</th>
              <th>Confidence</th>
              <th>Source</th>
              <th>Status / Issues</th>
            </tr>
          </thead>
          <tbody>
            {order.map((key) => {
              const field = fields[key];
              const value = finalValues[key] ?? field?.value ?? "";
              const confidence =
                typeof field?.confidence === "number"
                  ? `${(field.confidence * 100).toFixed(1)}%`
                  : "—";

              return (
                <tr key={key}>
                  <td>{labels[key] ?? key.replace(/_/g, " ")}</td>
                  <td>{value.trim() || "Not detected"}</td>
                  <td className="num">{confidence}</td>
                  <td>{field?.source || "—"}</td>
                  <td>
                    <Pill value={field?.status ?? "missing"} />
                    {field?.issues?.map((issue, index) => (
                      <div className="tiny warn-text" key={index}>
                        {issue}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
            {order.length === 0 && (
              <tr>
                <td colSpan={5}>No OCR fields returned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {item.quality?.acceptable === false && (
        <p className="tiny warn-text">Image quality requires review.</p>
      )}

      {item.quality?.issues?.map((issue, index) => (
        <p className="tiny warn-text" key={issue.code ?? index}>
          {issue.message}
        </p>
      ))}

      <p className="tiny muted">
        Verify extracted values against the original cheque before accepting.
      </p>
    </div>
  );
}

export default function Batch() {
  const { can } = useAuth();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  const addFiles = (incoming: File[]) => {
    setFiles((current) => [...current, ...incoming].slice(0, MAX));
  };

  const run = async () => {
    if (busy || files.length === 0) return;

    const fd = new FormData();
    files.forEach((file) => fd.append("files", file));

    setBusy(true);
    setResult(null);

    try {
      const response = await post<BatchResult>("/api/cheques/batch", fd);
      setResult(response);
      setFiles([]);
      toast(
        response.failed ? "info" : "success",
        `${response.processed} processed, ${response.failed} failed`,
      );
    } catch (error) {
      toast("error", errText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!can("admin", "operator")) {
    return <Empty title="Batch processing needs operator access" />;
  }

  const displayedFields = result?.results.reduce(
    (total, item) =>
      total +
      (item.ok
        ? (item.field_order?.length ?? Object.keys(item.fields ?? {}).length)
        : 0),
    0,
  ) ?? 0;

  return (
    <>
      <PageHead
        title="Batch processing"
        sub={`Process up to ${MAX} cheques at once using OCR, validation and signature detection.`}
      />

      <Panel title="Upload cheque images">
        <FileDrop
          multiple
          label="Drop cheque images here, or click to choose several"
          onFiles={addFiles}
        />

        {files.length > 0 && (
          <>
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <span className="tiny muted">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    className="icon-btn"
                    disabled={busy}
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            <div className="row-actions">
              <Button disabled={busy} onClick={() => setFiles([])}>
                Clear
              </Button>
              <Button
                kind="primary"
                icon="play"
                busy={busy}
                disabled={busy}
                onClick={run}
              >
                Process {files.length} cheque{files.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}

        {busy && (
          <p className="tiny muted">
            Processing images on the server. Keep this page open.
          </p>
        )}

        <p className="tiny muted">
          Selected: {files.length}/{MAX} images.
        </p>
      </Panel>

      {result && (
        <>
          <Panel
            title={`Batch ${result.batch_id}`}
            actions={
              <span className="tiny muted">
                {result.processed} processed · {result.failed} failed
              </span>
            }
          >
            <div className="row-actions">
              <span>{result.processed} successful</span>
              <span>{result.failed} failed</span>
              <span>{displayedFields} field results returned</span>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Result</th>
                    <th>Bank</th>
                    <th>Cheque no.</th>
                    <th>Payee</th>
                    <th className="r">Amount</th>
                    <th>Review fields</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item, index) => (
                    <tr key={`${item.file}-${index}`}>
                      <td>
                        {item.ok && item.id ? (
                          <a href={`#/cheques/${item.id}`}>{item.file}</a>
                        ) : item.file}
                      </td>
                      <td>
                        {item.ok ? (
                          <Pill value={item.status ?? "processed"} />
                        ) : (
                          <span className="bad-text">
                            {item.error ?? "Processing failed"}
                          </span>
                        )}
                      </td>
                      <td>{item.bank_name || "—"}</td>
                      <td>{item.cheque_number || "—"}</td>
                      <td>{item.payee_name || "—"}</td>
                      <td className="num r">
                        {item.amount_figures
                          ? `₹ ${item.amount_figures}`
                          : "—"}
                      </td>
                      <td className="num">
                        {item.ok ? (item.review_count ?? "—") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Complete OCR field results"
            actions={
              <span className="tiny muted">
                {displayedFields} fields · {result.processed} successful cheques
              </span>
            }
          >
            {result.results.map((item, index) => (
              <div className="batch-detail" key={`${item.file}-${index}`}>
                {item.ok ? (
                  <details>
                    <summary>
                      <b>{item.file}</b>
                      <span className="tiny muted">
                        Cheque #{item.id} ·{" "}
                        {item.field_order?.length ??
                          Object.keys(item.fields ?? {}).length} fields
                      </span>
                      <Pill value={item.status ?? "processed"} />
                    </summary>
                    <FieldResults item={item} />
                  </details>
                ) : (
                  <p className="tiny bad-text">
                    {item.file}: {item.error ?? "Processing failed"}
                  </p>
                )}
              </div>
            ))}

            {result.processed === 0 && (
              <Empty title="No cheque was processed successfully" />
            )}
          </Panel>
        </>
      )}
    </>
  );
}