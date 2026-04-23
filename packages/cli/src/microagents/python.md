---
triggers:
  - python
  - pytest
  - pip
  - virtualenv
  - django
  - flask
  - numpy
  - pandas
---

# Python Development Patterns

## Running Tests
```bash
# Run specific test file
python -m pytest path/to/test_file.py -xvs

# Run specific test function  
python -m pytest path/to/test_file.py::TestClass::test_method -xvs

# Run with output capture disabled
python -m pytest -s tests/

# Check if tests fail (for baseline verification)
python -m pytest path/to/test.py --tb=short 2>&1 | tail -20
```

## Environment Setup
```bash
# Encoding fix (always set before running Python)
export PYTHONIOENCODING=utf-8

# Install package in development mode
pip install -e . --quiet

# Install test dependencies
pip install pytest pytest-xdist 2>&1 | tail -5
```

## Common Fixes
- `ImportError`: Check `__init__.py` files and import paths
- `AttributeError`: Check if method/property exists on the class
- `TypeError: unexpected keyword argument`: Check function signature compatibility
- Encoding issues: Add `# -*- coding: utf-8 -*-` or use `encoding='utf-8'` in open()
