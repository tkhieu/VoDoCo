"""Execute the shipped notebook using this pinned environment and persist real outputs."""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import nbformat
from ipykernel.kernelspec import install
from nbclient import NotebookClient

from common import ROOT, write_json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["full", "smoke"], default="full")
    args = parser.parse_args()
    experiment = ROOT / "experiments/002-vietmed-correction-training"
    notebook_path = experiment / "train_correction_end_to_end.ipynb"
    outputs = experiment / "outputs" / args.mode
    outputs.mkdir(parents=True, exist_ok=True)
    install(user=False, prefix=sys.prefix, kernel_name="vodoco-correction", display_name="VoDoCo correction (Python 3.12)")
    os.environ["JUPYTER_PATH"] = str(Path(sys.prefix) / "share/jupyter") + os.pathsep + os.environ.get("JUPYTER_PATH", "")
    os.environ["VODOCO_PROJECT_ROOT"] = str(ROOT)
    os.environ["CORRECTION_MODE"] = args.mode
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    notebook = nbformat.read(notebook_path, as_version=4)
    nbformat.validate(notebook)
    for cell in notebook.cells:
        if cell.cell_type == "code":
            cell.outputs = []
            cell.execution_count = None
    destination = notebook_path if args.mode == "full" else outputs / "smoke-executed.ipynb"
    started = time.monotonic()
    progress = {"mode": args.mode, "complete": False, "executed_code_cells": 0,
                "notebook": str(destination), "interpreter": sys.executable}

    def save():
        temporary = destination.with_suffix(".ipynb.tmp")
        nbformat.write(notebook, temporary)
        temporary.replace(destination)
        progress["seconds"] = time.monotonic() - started
        write_json(outputs / "notebook-execution.json", progress)

    class StreamingClient(NotebookClient):
        last_save = 0.0

        def process_message(self, msg, cell, cell_index):
            result = super().process_message(msg, cell, cell_index)
            if msg.get("msg_type") == "stream":
                print(msg["content"].get("text", ""), end="", flush=True)
            if time.monotonic() - self.last_save > 30:
                save()
                self.last_save = time.monotonic()
            return result

    def cell_finished(cell, cell_index, execute_reply, **kwargs):
        progress["executed_code_cells"] += 1
        progress["last_cell_index"] = cell_index
        print(f"Notebook completed code cell {progress['executed_code_cells']} (index {cell_index})", flush=True)
        save()

    print(f"Executing notebook in {args.mode} mode with a new kernel", flush=True)
    client = StreamingClient(notebook, timeout=None, kernel_name="vodoco-correction",
                             resources={"metadata": {"path": str(experiment)}},
                             allow_errors=False, on_cell_executed=cell_finished)
    try:
        client.execute()
        if any(output.output_type == "error" for cell in notebook.cells if cell.cell_type == "code" for output in cell.outputs):
            raise RuntimeError("Notebook contains execution errors")
        progress["complete"] = True
        print("Notebook execution completed successfully", flush=True)
    except BaseException as error:
        progress["error"] = {"type": type(error).__name__, "message": str(error)}
        raise
    finally:
        save()


if __name__ == "__main__":
    main()
