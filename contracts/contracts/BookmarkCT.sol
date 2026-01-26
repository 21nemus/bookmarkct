// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BookmarkCT {
    struct Bookmark {
        address owner;
        string sourceUrl;
        bytes32 summaryHash;
        string summaryPreview;
        uint256 createdAt;
    }

    Bookmark[] private bookmarks;

    event BookmarkCreated(
        uint256 id,
        address owner,
        string sourceUrl,
        bytes32 summaryHash,
        string summaryPreview,
        uint256 createdAt
    );

    function createBookmark(
        string calldata sourceUrl,
        bytes32 summaryHash,
        string calldata summaryPreview
    ) external {
        require(bytes(summaryPreview).length <= 200, "Summary preview too long");

        Bookmark memory newBookmark = Bookmark({
            owner: msg.sender,
            sourceUrl: sourceUrl,
            summaryHash: summaryHash,
            summaryPreview: summaryPreview,
            createdAt: block.timestamp
        });

        bookmarks.push(newBookmark);

        emit BookmarkCreated(
            bookmarks.length - 1,
            msg.sender,
            sourceUrl,
            summaryHash,
            summaryPreview,
            block.timestamp
        );
    }

    function getBookmark(uint256 id) external view returns (Bookmark memory) {
        require(id < bookmarks.length, "Bookmark not found");
        return bookmarks[id];
    }

    function count() external view returns (uint256) {
        return bookmarks.length;
    }
}
