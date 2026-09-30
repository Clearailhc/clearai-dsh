"""Regression tests for secure XML metadata extraction."""

import unittest

from extract_metadata import MetadataExtractor


class FakeResponse:
    """Minimal response object used by the extractor."""

    def __init__(self, content: bytes, status_code: int = 200):
        self.content = content
        self.status_code = status_code


class MetadataExtractorTests(unittest.TestCase):
    def setUp(self):
        self.extractor = MetadataExtractor()

    def test_extracts_pubmed_metadata(self):
        self.extractor.session.get = lambda *args, **kwargs: FakeResponse(
            b"""<?xml version="1.0"?>
            <PubmedArticleSet>
              <PubmedArticle>
                <MedlineCitation>
                  <Article>
                    <ArticleTitle>Secure XML Parsing</ArticleTitle>
                    <AuthorList>
                      <Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author>
                    </AuthorList>
                    <Journal>
                      <JournalIssue><Volume>42</Volume><Issue>7</Issue>
                        <PubDate><Year>2026</Year></PubDate>
                      </JournalIssue>
                      <Title>Example Journal</Title>
                    </Journal>
                    <Pagination><MedlinePgn>1-10</MedlinePgn></Pagination>
                  </Article>
                </MedlineCitation>
                <PubmedData>
                  <ArticleIdList><ArticleId IdType="doi">10.1000/example</ArticleId></ArticleIdList>
                </PubmedData>
              </PubmedArticle>
            </PubmedArticleSet>"""
        )

        metadata = self.extractor.extract_from_pmid("12345678")

        self.assertEqual(metadata["title"], "Secure XML Parsing")
        self.assertEqual(metadata["authors"], "Doe, Jane")
        self.assertEqual(metadata["year"], "2026")
        self.assertEqual(metadata["doi"], "10.1000/example")

    def test_extracts_arxiv_metadata(self):
        self.extractor.session.get = lambda *args, **kwargs: FakeResponse(
            b"""<?xml version="1.0"?>
            <feed xmlns="http://www.w3.org/2005/Atom"
                  xmlns:arxiv="http://arxiv.org/schemas/atom">
              <entry>
                <title>Secure XML Parsing</title>
                <published>2026-01-01T00:00:00Z</published>
                <author><name>Jane Doe</name></author>
                <summary>Example abstract</summary>
                <arxiv:doi>10.1000/example</arxiv:doi>
              </entry>
            </feed>"""
        )

        metadata = self.extractor.extract_from_arxiv("2601.12345")

        self.assertEqual(metadata["title"], "Secure XML Parsing")
        self.assertEqual(metadata["authors"], "Jane Doe")
        self.assertEqual(metadata["year"], "2026")
        self.assertEqual(metadata["doi"], "10.1000/example")

    def test_rejects_external_entities(self):
        self.extractor.session.get = lambda *args, **kwargs: FakeResponse(
            b"""<?xml version="1.0"?>
            <!DOCTYPE PubmedArticleSet [
              <!ENTITY xxe SYSTEM "file:///etc/passwd">
            ]>
            <PubmedArticleSet><PubmedArticle><MedlineCitation>
              <Article><ArticleTitle>&xxe;</ArticleTitle></Article>
            </MedlineCitation></PubmedArticle></PubmedArticleSet>"""
        )

        self.assertIsNone(self.extractor.extract_from_pmid("12345678"))


if __name__ == "__main__":
    unittest.main()
