"""svinooh earn — a catalog of single-token yield.

Four layers, and the dependency arrow only ever points inwards:

    api  ──▶  application  ──▶  domain  ◀──  infrastructure

- `domain` is the model and the rules. It imports nothing from the other three
  and nothing from the network, the clock or the environment.
- `application` orchestrates: it defines the ports the outside world must fit
  through, and the use cases that answer a question.
- `infrastructure` implements those ports — Kamino's API, HTTP, settings.
- `api` is one delivery mechanism (HTTP) and knows nothing but the application.

`tests/test_layering.py` enforces the arrow, so it cannot rot into a comment.
"""
