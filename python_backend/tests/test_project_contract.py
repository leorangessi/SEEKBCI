from app.schemas.project_contract import ensure_contract_version, validate_seekbci_project


def test_validate_minimal_project():
    ok, errs = validate_seekbci_project({"name": "A", "pages": [{"blocks": []}]})
    assert ok
    assert not errs


def test_validate_rejects_empty_pages():
    ok, errs = validate_seekbci_project({"name": "A", "pages": []})
    assert not ok
    assert any("页面" in e for e in errs)


def test_ensure_contract_version():
    out = ensure_contract_version({"name": "X", "pages": [{"blocks": []}]})
    assert out["contractVersion"] == 1
