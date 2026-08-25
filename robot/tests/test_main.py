from __future__ import annotations

import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from friday_robot.__main__ import argument_parser


class MainTests(unittest.TestCase):
    def test_only_real_alphabot2_mode_can_be_selected(self):
        parser = argument_parser()
        self.assertEqual(parser.parse_args(["--mode", "alphabot2"]).mode, "alphabot2")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            parser.parse_args(["--mode", "simulated"])


if __name__ == "__main__":
    unittest.main()
